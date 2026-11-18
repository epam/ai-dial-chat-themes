/*
 * Proves that check-celebration-packs.mjs rejects broken composer-anchor
 * placements and composer-outline slots. Each case copies static/celebrations
 * into a temporary directory, breaks one thing in new-year-default@1.1.0,
 * re-hashes what it changed and expects the checker to fail with a message.
 *
 * Usage: node --test scripts/check-celebration-packs.test.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const SCRIPTS = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(SCRIPTS, '../static/celebrations');
const PACK = 'new-year-default/1.1.0';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const directories = [];

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/* Writes the manifest and points the index at its new size and hash. */
const saveManifest = (root, manifest) => {
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(root, PACK, 'manifest.json'), bytes);
  const index = readJson(join(root, 'index.json'));
  const entry = index.packs.find(
    ({ manifest: ref }) => ref.path === `${PACK}/manifest.json`,
  );
  entry.manifest.bytes = bytes.length;
  entry.manifest.sha256 = sha256(bytes);
  writeFileSync(join(root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
};

/* Replaces an animation's JSON, renaming the file and asset ID to the new hash. */
const replaceAnimation = (root, manifest, assetId, edit) => {
  const asset = manifest.assets.find((item) => item.assetId === assetId);
  const animation = readJson(join(root, PACK, asset.file));
  edit(animation);
  const bytes = Buffer.from(JSON.stringify(animation));
  const hash = sha256(bytes);
  const prefix = hash.slice(0, 16);
  const file = asset.file.replace(/[0-9a-f]{16}\.json$/, `${prefix}.json`);
  rmSync(join(root, PACK, asset.file));
  writeFileSync(join(root, PACK, file), bytes);
  const nextId = assetId.replace(/[0-9a-f]{16}$/, prefix);
  Object.assign(asset, { assetId: nextId, file, bytes: bytes.length, sha256: hash });
  for (const scene of manifest.scenes)
    for (const variant of scene.variants)
      if (variant.animationAssetId === assetId) variant.animationAssetId = nextId;
};

const giftWrapping = (manifest) =>
  manifest.scenes.find(({ id }) => id === 'gift-wrapping');

const desktopAnimationId = (manifest) =>
  giftWrapping(manifest).variants.find(({ when }) => when.layout === 'desktop')
    .animationAssetId;

/* Copies the published packs, applies `breakPack` and runs the checker. */
const check = (breakPack) => {
  const root = mkdtempSync(join(tmpdir(), 'celebration-packs-'));
  directories.push(root);
  cpSync(SOURCE, root, { recursive: true });
  if (breakPack) {
    const manifest = readJson(join(root, PACK, 'manifest.json'));
    breakPack(root, manifest);
    saveManifest(root, manifest);
  }
  const result = spawnSync(
    process.execPath,
    [join(SCRIPTS, 'check-celebration-packs.mjs'), root],
    { encoding: 'utf8' },
  );
  return { status: result.status, output: result.stdout + result.stderr };
};

const setPlacement = (override) => (_root, manifest) => {
  Object.assign(giftWrapping(manifest).placement, override);
};

const editOutline = (edit) => (root, manifest) =>
  replaceAnimation(root, manifest, desktopAnimationId(manifest), (animation) =>
    edit(animation, animation.layers.find(({ nm }) => nm === 'composer-outline')),
  );

after(() => directories.forEach((root) => rmSync(root, { recursive: true, force: true })));

describe('check-celebration-packs', () => {
  it('accepts the published packs', () => {
    const { status, output } = check();
    assert.equal(status, 0, output);
  });

  it('accepts a re-hashed animation that keeps its slots', () => {
    const { status, output } = check(editOutline(() => {}));
    assert.equal(status, 0, output);
  });

  for (const [name, override, message] of [
    ['an edge other than top or bottom', { edge: 'left' }, /edge must be top or bottom/],
    ['scale.min above scale.max', { scale: { min: 1.2, max: 1 } }, /scale needs/],
    ['scale.min below 0.25', { scale: { min: 0.1, max: 1 } }, /scale needs/],
    ['the S0 viewport-stage-v1 fallback', { fallback: 'viewport-stage-v1' }, /fallback must be/],
    ['a non-finite anchorRect', { anchorRect: { x: 0, y: 0, width: 'wide', height: 56 } }, /anchorRect needs/],
    ['an anchorRect narrower than 120', { anchorRect: { x: 0, y: 0, width: 100, height: 56 } }, /anchorRect needs/],
    ['an anchorRect outside the stage', { anchorRect: { x: 1000, y: 164, width: 520, height: 56 } }, /outside the 1200 x 280 stage/],
    ['an unknown anchor', { anchor: 'sidebar' }, /anchor must be composer/],
  ])
    it(`rejects a composer-anchor placement with ${name}`, () => {
      const { status, output } = check(setPlacement(override));
      assert.equal(status, 1);
      assert.match(output, message);
    });

  const mobileVariant = (manifest) =>
    giftWrapping(manifest).variants.find(({ when }) => when.layout === 'mobile');

  it('rejects a variant placement with another template', () => {
    const { status, output } = check((_root, manifest) => {
      mobileVariant(manifest).placement = {
        template: 'viewport-stage-v1',
        fit: 'contain',
        align: 'bottom',
      };
    });
    assert.equal(status, 1);
    assert.match(output, /placement.template differs from the scene's/);
  });

  it('rejects a variant anchorRect outside its own stage', () => {
    const { status, output } = check((_root, manifest) => {
      mobileVariant(manifest).placement.anchorRect = {
        x: 340,
        y: 164,
        width: 520,
        height: 56,
      };
    });
    assert.equal(status, 1);
    assert.match(output, /outside the 720 x 240 stage/);
  });

  it('rejects a misspelled variant field', () => {
    const { status, output } = check((_root, manifest) => {
      const variant = mobileVariant(manifest);
      variant.placment = variant.placement;
      delete variant.placement;
    });
    assert.equal(status, 1);
    assert.match(output, /placment is not allowed/);
  });

  it('rejects the outline adapter on a viewport stage', () => {
    const { status, output } = check(
      setPlacement({
        template: 'viewport-stage-v1',
        fit: 'contain',
        align: 'bottom',
      }),
    );
    assert.equal(status, 1);
    assert.match(output, /interaction-composer-outline-v1 without composer-anchor-v1/);
  });

  it('rejects an anchored placement the scene does not require', () => {
    const { status, output } = check((_root, manifest) => {
      const scene = giftWrapping(manifest);
      scene.requiredCapabilities = scene.requiredCapabilities.filter(
        (id) => id !== 'composer-anchor-v1',
      );
    });
    assert.equal(status, 1);
    assert.match(output, /without requiring it/);
  });

  for (const [name, edit, message] of [
    [
      'a missing composer-outline layer',
      (animation) => {
        animation.layers = animation.layers.filter(({ nm }) => nm !== 'composer-outline');
      },
      /exactly one top-level composer-outline layer, found 0/,
    ],
    [
      'two composer-outline layers',
      (animation, outline) => animation.layers.push(structuredClone(outline)),
      /exactly one top-level composer-outline layer, found 2/,
    ],
    [
      'a moved composer-outline layer',
      (_animation, outline) => {
        outline.ks.p = { a: 0, k: [10, 0] };
      },
      /composer-outline must be a shape layer with an identity transform/,
    ],
    [
      'an animated outline path',
      (_animation, outline) => {
        const path = outline.shapes[0].it.find(({ ty }) => ty === 'sh');
        path.ks = { a: 1, k: [{ t: 0, s: [path.ks.k] }, { t: 10, s: [path.ks.k] }] };
      },
      /composer-outline sh must not be animated/,
    ],
    [
      'two composer-parcel layers',
      (animation) =>
        animation.layers.push(
          structuredClone(animation.layers.find(({ nm }) => nm === 'composer-parcel')),
        ),
      /2 composer-parcel layers/,
    ],
  ])
    it(`rejects an outline animation with ${name}`, () => {
      const { status, output } = check(editOutline(edit));
      assert.equal(status, 1);
      assert.match(output, message);
    });
});
