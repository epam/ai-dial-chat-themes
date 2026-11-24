/*
 * Proves that check-celebration-packs.mjs rejects broken composer-anchor
 * placements, composer-outline slots, cat-borrow slots and markers,
 * composer-carry tracks, and copy-track slots, markers, references and
 * poses. Each case copies static/celebrations into a temporary directory,
 * breaks one thing in new-year-default@1.1.0 or @1.2.0,
 * new-year-polar-bears@1.0.0 or halloween-default@1.0.0,
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
const CAT_PACK = 'halloween-default/1.0.0';
const SNOWMAN_PACK = 'new-year-default/1.2.0';
const CARRY_PACK = 'new-year-polar-bears/1.0.0';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const directories = [];

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/* Writes the manifest and points the index at its new size and hash. */
const saveManifest = (root, manifest, pack = PACK) => {
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(root, pack, 'manifest.json'), bytes);
  const index = readJson(join(root, 'index.json'));
  const entry = index.packs.find(
    ({ manifest: ref }) => ref.path === `${pack}/manifest.json`,
  );
  entry.manifest.bytes = bytes.length;
  entry.manifest.sha256 = sha256(bytes);
  writeFileSync(join(root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
};

/* Replaces an animation's JSON, renaming the file and asset ID to the new hash. */
const replaceAnimation = (root, manifest, assetId, edit, pack = PACK) => {
  const asset = manifest.assets.find((item) => item.assetId === assetId);
  const animation = readJson(join(root, pack, asset.file));
  edit(animation);
  const bytes = Buffer.from(JSON.stringify(animation));
  const hash = sha256(bytes);
  const prefix = hash.slice(0, 16);
  const file = asset.file.replace(/[0-9a-f]{16}\.json$/, `${prefix}.json`);
  rmSync(join(root, pack, asset.file));
  writeFileSync(join(root, pack, file), bytes);
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
const check = (breakPack, pack = PACK) => {
  const root = mkdtempSync(join(tmpdir(), 'celebration-packs-'));
  directories.push(root);
  cpSync(SOURCE, root, { recursive: true });
  if (breakPack) {
    const manifest = readJson(join(root, pack, 'manifest.json'));
    breakPack(root, manifest);
    saveManifest(root, manifest, pack);
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

const carryScene = (manifest) => manifest.scenes.find(({ id }) => id === 'polar-bears-workshop');
const carrySlot = (animation, name = 'composer-carry') => animation.layers.find(({ nm }) => nm === name);
const editCarry = (edit) => (root, manifest) =>
  replaceAnimation(root, manifest,
    carryScene(manifest).variants.find(({ when }) => when.layout === 'desktop').animationAssetId,
    (animation) => edit(animation, carrySlot(animation)), CARRY_PACK);

const catScene = (manifest) => manifest.scenes.find(({ id }) => id === 'cat');

/* Edits the cat animation; `rig` is the cat-rig precomposition's layer list. */
const editCat = (edit) => (root, manifest) =>
  replaceAnimation(
    root,
    manifest,
    catScene(manifest).variants[0].animationAssetId,
    (animation) => {
      const rig = animation.layers.find(({ nm }) => nm === 'cat-rig');
      const { layers } = animation.assets.find(({ id }) => id === rig.refId);
      edit(animation, layers, rig);
    },
    CAT_PACK,
  );

const catMarker = (animation, cm) => animation.markers.find((marker) => marker.cm === cm);

/* The keyframes of one property of a borrowed button's authored track. */
const prizeTrack = (layers, prize, key) => layers.find(({ nm }) => nm === `prize-${prize}`).ks[key].k;

const snowmanScene = (manifest) => manifest.scenes.find(({ id }) => id === 'snowman-delivery');

/* Edits the desktop SnowmanDelivery animation; `actor` is the ct-actor precomposition's layer list. */
const editSnowman = (edit) => (root, manifest) =>
  replaceAnimation(
    root,
    manifest,
    snowmanScene(manifest).variants.find(({ when }) => when.layout === 'desktop').animationAssetId,
    (animation) => {
      const actor = animation.layers.find(({ nm }) => nm === 'ct-actor');
      const { layers } = animation.assets.find(({ id }) => id === actor.refId);
      edit(animation, layers);
    },
    SNOWMAN_PACK,
  );

const ctMarker = (animation, cm) => animation.markers.find((marker) => marker.cm === cm);
const rootKeys = (layers) => layers.find(({ nm }) => nm === 'ct-track:root').ks.p.k;

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
  it('accepts a re-hashed cat animation that keeps its slots and markers', () => {
    const { status, output } = check(editCat(() => {}), CAT_PACK);
    assert.equal(status, 0, output);
  });

  /* Chat compares easing after its linear collapse and four-decimal rounding. */
  for (const [name, edit] of [
    [
      'prize tangents left out where another track is linear',
      (_animation, layers) => {
        for (const keyframe of prizeTrack(layers, 1, 'r')) {
          delete keyframe.o;
          delete keyframe.i;
        }
      },
    ],
    [
      'prize tangents that round to linear',
      (_animation, layers) => {
        for (const keyframe of prizeTrack(layers, 1, 'r'))
          if (keyframe.o) keyframe.o = { x: [0.00001], y: [0] };
      },
    ],
  ])
    it(`accepts a cat animation with ${name}`, () => {
      const { status, output } = check(editCat(edit), CAT_PACK);
      assert.equal(status, 0, output);
    });

  for (const [name, edit, message] of [
    [
      'direction mirror',
      (_root, manifest) => {
        catScene(manifest).direction = 'mirror';
      },
      /interaction-cat-borrow-v1 with direction mirror; it needs none/,
    ],
    [
      'a viewport-stage placement',
      (_root, manifest) => {
        const scene = catScene(manifest);
        scene.placement = { template: 'viewport-stage-v1', fit: 'contain', align: 'bottom' };
        scene.requiredCapabilities = scene.requiredCapabilities.filter((id) => id !== 'composer-anchor-v1');
        for (const variant of scene.variants) delete variant.placement;
      },
      /interaction-cat-borrow-v1 without composer-anchor-v1 placement/,
    ],
    [
      'the outline adapter as well',
      (_root, manifest) => {
        catScene(manifest).requiredCapabilities.push('interaction-composer-outline-v1');
      },
      /requires more than one interaction adapter/,
    ],
  ])
    it(`rejects a cat scene with ${name}`, () => {
      const { status, output } = check(edit, CAT_PACK);
      assert.equal(status, 1);
      assert.match(output, message);
    });

  it('reports a broken cat animation once although both variants share it', () => {
    const { status, output } = check(
      editCat((animation) => {
        animation.markers.push({ cm: 'cat:jump', tm: 10, dr: 0 });
      }),
      CAT_PACK,
    );
    assert.equal(status, 1);
    assert.equal(output.match(/marker cat:jump is unknown/g)?.length, 1, output);
    assert.doesNotMatch(output, /marker undefined/);
    assert.match(output, /Celebration packs: 1 error\(s\)/);
  });

  for (const [name, edit, message] of [
    /* cat-rig */
    [
      'no cat-rig',
      (animation) => {
        animation.layers.find(({ nm }) => nm === 'cat-rig').nm = 'rig';
      },
      /needs exactly one top-level cat-rig precomposition, found 0/,
    ],
    [
      'an authored time remap on cat-rig',
      (_animation, _layers, rig) => {
        rig.tm = { a: 1, k: [{ t: 0, s: [0] }, { t: 10, s: [0.2] }] };
      },
      /cat-rig has its own time remap/,
    ],
    [
      'a cat-rig that starts late',
      (_animation, _layers, rig) => {
        rig.st = 5;
      },
      /cat-rig must start at frame 0/,
    ],
    [
      'a parented cat-rig',
      (_animation, _layers, rig) => {
        rig.parent = 2;
      },
      /cat-rig must not have a parent/,
    ],
    [
      'a cat-rig without an anchor point',
      (_animation, _layers, rig) => {
        delete rig.ks.a;
      },
      /cat-rig anchor and position must be static points/,
    ],
    [
      'a rotating cat-rig',
      (_animation, _layers, rig) => {
        rig.ks.r = { a: 1, k: [{ t: 0, s: [0] }, { t: 10, s: [5] }] };
      },
      /cat-rig scale must be 100 % and rotation 0°, unanimated/,
    ],
    [
      'a statically scaled cat-rig',
      (_animation, _layers, rig) => {
        rig.ks.s = { a: 0, k: [90, 90, 100] };
      },
      /cat-rig scale must be 100 % and rotation 0°, unanimated/,
    ],
    [
      'a composition that does not start at frame 0',
      (animation) => {
        animation.ip = 10;
      },
      /the composition must start at frame 0/,
    ],
    /* cat-root, cat-facing and anchors */
    [
      'a parented cat-root',
      (_animation, layers) => {
        layers.find(({ nm }) => nm === 'cat-root').parent = 1;
      },
      /cat-root must be an unparented null/,
    ],
    [
      'two cat-facing layers',
      (_animation, layers) => {
        layers.push({ ...structuredClone(layers.find(({ nm }) => nm === 'cat-facing')), ind: 99 });
      },
      /needs exactly one cat-facing layer in cat-rig, found 2/,
    ],
    [
      'a cat-root keyframe with an end value',
      (_animation, layers) => {
        const [keyframe] = layers.find(({ nm }) => nm === 'cat-root').ks.p.k;
        keyframe.e = keyframe.s;
      },
      /cat-root keyframes need a numeric start value and no end value/,
    ],
    [
      'spatial tangents on cat-root',
      (_animation, layers) => {
        const root = layers.find(({ nm }) => nm === 'cat-root');
        root.ks.p.k[1].to = [10, 0, 0];
      },
      /cat-root keyframes must have no spatial tangents/,
    ],
    [
      'a cat-root keyframe outside every bind range',
      (animation) => {
        animation.markers = animation.markers.filter(({ cm }) => cm !== 'cat:bind:perch');
      },
      /cat-root keyframe at frame 186 lies outside every cat:bind range/,
    ],
    [
      'a cat-facing keyframe with an end value',
      (_animation, layers) => {
        const [keyframe] = layers.find(({ nm }) => nm === 'cat-facing').ks.s.k;
        keyframe.e = keyframe.s;
      },
      /cat-facing keyframes need a numeric start value and no end value/,
    ],
    [
      'an eased cat-facing keyframe',
      (_animation, layers) => {
        delete layers.find(({ nm }) => nm === 'cat-facing').ks.s.k[0].h;
      },
      /cat-facing scale must be hold keyframes/,
    ],
    [
      'a cat-facing keyframe outside every bind range',
      (_animation, layers) => {
        layers.find(({ nm }) => nm === 'cat-facing').ks.s.k.at(-1).t = 2752;
      },
      /cat-facing keyframe at frame 2752 lies outside every cat:bind range/,
    ],
    [
      'a missing anchor null',
      (_animation, layers) => {
        const index = layers.findIndex(({ nm }) => nm === 'anchor:perch');
        layers.splice(index, 1);
      },
      /anchor:perch must be one unparented null with a static position/,
    ],
    [
      'an anchor position without a = 0',
      (_animation, layers) => {
        delete layers.find(({ nm }) => nm === 'anchor:perch').ks.p.a;
      },
      /anchor:perch must be one unparented null with a static position/,
    ],
    /* markers */
    [
      'markers that are not a list',
      (animation) => {
        animation.markers = {};
      },
      /markers is not a list/,
    ],
    [
      'an unknown cat marker',
      (animation) => {
        animation.markers.push({ cm: 'cat:jump', tm: 10, dr: 0 });
      },
      /marker cat:jump is unknown/,
    ],
    [
      'an unknown marker argument',
      (animation) => {
        animation.markers.push({ cm: 'cat:entry:2', tm: 600, dr: 0 });
      },
      /marker cat:entry:2 has an unknown argument/,
    ],
    [
      'a section without a duration',
      (animation) => {
        catMarker(animation, 'cat:section:crossing').dr = 0;
      },
      /marker cat:section:crossing needs a duration/,
    ],
    [
      'an entry with a duration',
      (animation) => {
        catMarker(animation, 'cat:entry:0').dr = 5;
      },
      /marker cat:entry:0 must not have a duration/,
    ],
    [
      'a zero-length marker at the rig end',
      (animation) => {
        catMarker(animation, 'cat:section:crossing').dr = 541;
        animation.markers.push({ cm: 'cat:restore', tm: 2752, dr: 0 });
      },
      /marker cat:restore lies outside the rig timeline 0\.\.2752/,
    ],
    [
      'no section',
      (animation) => {
        animation.markers = animation.markers.filter(({ cm }) => !cm.startsWith('cat:section:'));
      },
      /has no cat:section marker/,
    ],
    [
      'a repeated section',
      (animation, layers) => {
        for (const layer of layers) layer.op = 3000;
        animation.markers.push({ cm: 'cat:section:crossing', tm: 2760, dr: 100 });
      },
      /cat:section:crossing repeats in the timeline/,
    ],
    [
      'overlapping sections',
      (animation) => {
        catMarker(animation, 'cat:section:crossing').tm = 2200;
      },
      /cat:section:one-prize overlaps cat:section:crossing/,
    ],
    [
      'a marker outside every section',
      (animation) => {
        catMarker(animation, 'cat:section:crossing').dr = 500;
      },
      /marker cat:bind:exit-edge lies outside every section/,
    ],
    [
      'a duplicated bind in one section',
      (animation) => {
        animation.markers.push({ ...catMarker(animation, 'cat:bind:perch') });
      },
      /marker cat:bind:perch repeats in cat:section:two-prizes/,
    ],
    [
      'overlapping binds',
      (animation) => {
        catMarker(animation, 'cat:bind:perch').dr = 400;
      },
      /cat:bind:perch overlaps cat:bind:prize-0 in cat:section:two-prizes/,
    ],
    [
      'a fifth contact',
      (animation) => {
        animation.markers.push({ cm: 'cat:contact:0', tm: 700, dr: 0 });
      },
      /marker cat:contact:0 repeats in cat:section:two-prizes/,
    ],
    [
      'a release before its entry',
      (animation) => {
        const entry = catMarker(animation, 'cat:entry:0');
        const release = catMarker(animation, 'cat:release:0');
        [entry.tm, release.tm] = [release.tm, entry.tm];
      },
      /cat:release:0 comes before cat:entry:0 in cat:section:two-prizes/,
    ],
    [
      'a branch away from the first release',
      (animation) => {
        catMarker(animation, 'cat:branch:one-prize').tm = 780;
      },
      /cat:branch:one-prize must share its frame with cat:release:0 in cat:section:two-prizes/,
    ],
    /* prizes */
    [
      'two prize-0 layers',
      (_animation, layers) => {
        layers.push({ ...structuredClone(layers.find(({ nm }) => nm === 'prize-0')), ind: 99 });
      },
      /has 2 prize-0 layers in cat-rig; at most one is allowed/,
    ],
    [
      'a release without its bind',
      (animation) => {
        animation.markers = animation.markers.filter(({ cm }) => cm !== 'cat:bind:prize-1');
        catMarker(animation, 'cat:bind:move').dr = 642;
      },
      /cat:release:1 needs a cat:bind:prize-1 range/,
    ],
    [
      'a prize bind with no station after it',
      (animation) => {
        animation.markers = animation.markers.filter(({ cm }) => cm !== 'cat:bind:prize-1');
        catMarker(animation, 'cat:bind:move').dr = 642;
        animation.markers.find(({ cm, tm }) => cm === 'cat:bind:exit-edge' && tm === 2619).dr = 131;
        animation.markers.push({ cm: 'cat:bind:prize-1', tm: 2750.5, dr: 0.5 });
      },
      /cat:bind:prize-1 has no cat-root keyframe inside its range at frame 2750\.5/,
    ],
    [
      'a static prize position',
      (_animation, layers) => {
        const prize = layers.find(({ nm }) => nm === 'prize-1');
        prize.ks.p = { a: 0, k: prize.ks.p.k[0].s };
      },
      /prize-1 position must be keyframed/,
    ],
    [
      'an animated prize scale',
      (_animation, layers) => {
        const prize = layers.find(({ nm }) => nm === 'prize-0');
        prize.ks.s = { a: 1, k: [{ t: 0, s: [100, 100, 100] }, { t: 10, s: [90, 90, 100] }] };
      },
      /prize-0 must not animate its scale/,
    ],
    [
      'prize tracks at different times',
      (_animation, layers) => {
        prizeTrack(layers, 1, 'r')[1].t += 0.5;
      },
      /prize-1 tracks must share keyframe times and easing/,
    ],
    [
      'prize tracks with different easing',
      (_animation, layers) => {
        const [keyframe] = prizeTrack(layers, 1, 'r');
        keyframe.o = { x: [0.4], y: [0] };
        keyframe.i = { x: [0.6], y: [1] };
      },
      /prize-1 tracks must share keyframe times and easing/,
    ],
    [
      'non-numeric prize easing',
      (_animation, layers) => {
        prizeTrack(layers, 1, 'r')[0].o = { x: ['fast'], y: [0] };
      },
      /prize-1 has a keyframe with non-numeric easing/,
    ],
    [
      'no prize keyframe at the release',
      (_animation, layers) => {
        for (const key of ['p', 'r', 'o']) prizeTrack(layers, 1, key).pop();
      },
      /prize-1 has no keyframe at its release frame 1191/,
    ],
    /* stories */
    [
      'a two-prize story without cat:restore',
      (animation) => {
        animation.markers = animation.markers.filter(({ cm, tm }) => !(cm === 'cat:restore' && tm === 1380));
      },
      /the two-prizes story has no cat:restore/,
    ],
    [
      'a two-prize story without the second entry',
      (animation) => {
        animation.markers = animation.markers.filter(({ cm }) => cm !== 'cat:entry:1');
      },
      /the two-prizes story has no cat:entry:1/,
    ],
    [
      'a two-prize story without the last landing',
      (animation) => {
        animation.markers = animation.markers.filter(({ cm }) => cm !== 'cat:landing:1');
      },
      /the two-prizes story has no cat:landing:1/,
    ],
    [
      'a one-prize story without its release',
      (animation) => {
        animation.markers = animation.markers.filter(({ cm, tm }) => !(cm === 'cat:release:0' && tm === 1500));
      },
      /the one-prize story has no cat:release:0/,
    ],
    [
      'an elastic landing on its release frame',
      (animation) => {
        catMarker(animation, 'cat:landing:1').tm = 1191;
      },
      /the two-prizes story: cat:landing:1 has an elastic range but does not come after cat:release:1/,
    ],
    [
      'an elastic range across a story step',
      (animation) => {
        catMarker(animation, 'cat:branch:one-prize').tm = 790;
      },
      /the one-prize story: the elastic range of cat:landing:0 crosses a story step/,
    ],
    [
      'a story step without length',
      (animation) => {
        catMarker(animation, 'cat:branch:one-prize').tm = 0;
      },
      /the one-prize story has a range without length/,
    ],
    [
      'an entry in the first 1% of the story',
      (animation) => {
        catMarker(animation, 'cat:entry:0').tm = 10;
      },
      /the two-prizes story: cat:entry:0 must lie between 1% of the story and cat:restore/,
    ],
    [
      'a prize keyframe the story skips',
      (_animation, layers) => {
        for (const key of ['p', 'r', 'o']) {
          const track = prizeTrack(layers, 0, key);
          const index = track.findIndex(({ t }) => t === 789);
          track.splice(index + 1, 0, { ...structuredClone(track[index]), t: 1000 });
        }
      },
      /the one-prize story: prize-0 keyframe at frame 1000 never plays/,
    ],
    [
      'a story longer than the composition',
      (animation) => {
        animation.op = 1400;
      },
      /the two-prizes story lasts 1500 frames, beyond the composition's op 1400/,
    ],
    /* floor */
    [
      'two cat-floor layers',
      (animation) => {
        animation.layers.push({
          ...structuredClone(animation.layers.find(({ nm }) => nm === 'cat-floor')),
          ind: 99,
        });
      },
      /has 2 cat-floor layers; at most one is allowed/,
    ],
    [
      'a cat-floor with two rectangles',
      (animation) => {
        const { it: items } = animation.layers.find(({ nm }) => nm === 'cat-floor').shapes[0];
        items.unshift(structuredClone(items.find(({ ty }) => ty === 'rc')));
      },
      /cat-floor must be one group with one rectangle and one gradient fill/,
    ],
  ])
    it(`rejects a cat animation with ${name}`, () => {
      const { status, output } = check(editCat(edit), CAT_PACK);
      assert.equal(status, 1);
      assert.match(output, message);
    });

  for (const [name, edit, message] of [
    [
      'direction mirror',
      (_root, manifest) => {
        snowmanScene(manifest).direction = 'mirror';
      },
      /interaction-copy-track-v1 with direction mirror; it needs none/,
    ],
    [
      'a viewport-stage placement',
      (_root, manifest) => {
        const scene = snowmanScene(manifest);
        scene.placement = { template: 'viewport-stage-v1', fit: 'contain', align: 'bottom' };
        scene.requiredCapabilities = scene.requiredCapabilities.filter((id) => id !== 'composer-anchor-v1');
        for (const variant of scene.variants) delete variant.placement;
      },
      /interaction-copy-track-v1 without composer-anchor-v1 placement/,
    ],
    [
      'the cat adapter as well',
      (_root, manifest) => {
        snowmanScene(manifest).requiredCapabilities.push('interaction-cat-borrow-v1');
      },
      /requires more than one interaction adapter/,
    ],
  ])
    it(`rejects a SnowmanDelivery scene with ${name}`, () => {
      const { status, output } = check(edit, SNOWMAN_PACK);
      assert.equal(status, 1);
      assert.match(output, message);
    });

  for (const [name, edit, message] of [
    [
      'no ct-travel',
      (animation) => {
        animation.layers = animation.layers.filter(({ nm }) => nm !== 'ct-travel');
      },
      /needs exactly one top-level ct-travel null, found 0/,
    ],
    [
      'an unknown ct: marker',
      (animation) => {
        animation.markers.push({ cm: 'ct:jump', tm: 10, dr: 0 });
      },
      /unknown copy-track marker "ct:jump"/,
    ],
    [
      'a fill shorter than its cut',
      (animation) => {
        ctMarker(animation, 'ct:fill:rim-card').dr -= 1;
      },
      /a "rim-card" fill does not last as long as its cut/,
    ],
    [
      'no ct:entry while a section copies',
      (animation) => {
        animation.markers = animation.markers.filter(({ cm }) => cm !== 'ct:entry');
      },
      /a section copies but ct:entry or ct:restore is missing/,
    ],
    [
      'a missing minimum-span reference',
      (animation) => {
        animation.layers = animation.layers.filter(({ nm }) => nm !== 'anchor:far@min');
      },
      /needs exactly one anchor:far@min layer, found 0/,
    ],
    [
      'an override for an undeclared section',
      (animation) => {
        const layer = animation.layers.find(({ nm }) => nm === 'anchor:far#rim,platform');
        layer.nm = 'anchor:far#rim,sky';
      },
      /names no declared section "sky"/,
    ],
    [
      'an override of a fixed anchor',
      (animation) => {
        const layer = animation.layers.find(({ nm }) => nm === 'anchor:far#rim,platform');
        layer.nm = 'anchor:stance#rim';
      },
      /"anchor:stance#rim" overrides no reference/,
    ],
    [
      'a track keyframe outside every range',
      (animation) => {
        animation.markers = animation.markers.filter(({ cm, tm }) => !(cm === 'ct:bind:entry-edge' && tm === 0));
      },
      /ct-track:root keyframe at frame 0 lies outside every ct:bind and ct:stretch range/,
    ],
    [
      'a pose jump at a splice edge',
      (animation, layers) => {
        const fill = ctMarker(animation, 'ct:fill:rim-card');
        const key = rootKeys(layers).find(({ t }) => Math.abs(t - fill.tm) < 1e-6);
        key.s = [key.s[0] + 10, ...key.s.slice(1)];
      },
      /ct-track:root does not match its pose at the "rim-card" splice edge/,
    ],
    [
      'a cycle that does not close',
      (animation, layers) => {
        const cycle = ctMarker(animation, 'ct:cycle:0');
        const key = rootKeys(layers).find(({ t }) => Math.abs(t - (cycle.tm + cycle.dr)) < 1e-6);
        key.s = [key.s[0] + 10, ...key.s.slice(1)];
      },
      /ct-track:root does not close cycle 0/,
    ],
    [
      'a keyframe with neither a hold nor an easing',
      (_animation, layers) => {
        const key = rootKeys(layers)[1];
        delete key.o;
        delete key.i;
        delete key.h;
      },
      /has a keyframe at frame [\d.]+ with neither a hold nor an easing/,
    ],
    [
      'more than 48 layers',
      (animation) => {
        for (let i = 0; i < 3; i++)
          animation.layers.push({ ty: 3, nm: `extra-${i}`, ind: 990 + i, ip: 0, op: 1500, st: 0, ks: {} });
      },
      /49 layers exceed 48/,
    ],
    [
      'overlapping binds',
      (animation) => {
        animation.markers.push({ cm: 'ct:bind:far', tm: 940, dr: 10 });
      },
      /"ct:bind:far" overlaps "ct:bind:far"/,
    ],
    [
      'a cut that leaves the trunk',
      (animation) => {
        animation.markers.find(({ cm, tm }) => cm === 'ct:cut:rim-card' && tm === 1353).tm = 1480;
      },
      /a "rim-card" cut leaves the trunk/,
    ],
    [
      'a fill inside the trunk',
      (animation) => {
        ctMarker(animation, 'ct:fill:rim-card').tm = 100;
      },
      /a "rim-card" fill lies inside the trunk/,
    ],
    [
      'a trunk longer than the composition',
      (animation) => {
        animation.op = 1000;
      },
      /the trunk is longer than the composition/,
    ],
    [
      'a cycle window across a cut boundary',
      (animation) => {
        animation.markers.push(
          { cm: 'ct:cycle:2', tm: 225, dr: 10 },
          { cm: 'ct:cycle-window:2', tm: 225, dr: 30 },
        );
      },
      /cycle window 2 crosses a cut boundary/,
    ],
    [
      'a cycle window outside the trunk and every fill',
      (animation) => {
        animation.markers.push(
          { cm: 'ct:cycle:3', tm: 1520, dr: 10 },
          { cm: 'ct:cycle-window:3', tm: 1520, dr: 30 },
        );
      },
      /cycle window 3 lies in neither the trunk nor one fill/,
    ],
    [
      'a travel keyframe outside every bind',
      (animation) => {
        animation.layers.find(({ nm }) => nm === 'ct-travel').ks.p.k[0].t = 1.5;
      },
      /ct-travel keyframe at frame 1.5 lies outside every ct:bind range/,
    ],
    [
      'an override applied twice',
      (animation) => {
        animation.layers.push({ ty: 3, nm: 'anchor:far#rim', ind: 990, ip: 0, op: 1500, st: 0, ks: { p: { a: 0, k: [0, 0, 0] } } });
      },
      /anchor:far is overridden twice for "rim"/,
    ],
    [
      'a parented override',
      (animation) => {
        animation.layers.find(({ nm }) => nm === 'ct-follow:span-end#rim,platform').parent = 900;
      },
      /"ct-follow:span-end#rim,platform" must be an unparented null/,
    ],
    [
      'an override of a missing base',
      (animation) => {
        animation.layers.push({ ty: 3, nm: 'ct-follow:copy#rim', ind: 991, ip: 0, op: 1500, st: 0, ks: { p: { a: 0, k: [0, 0, 0] } } });
      },
      /"ct-follow:copy#rim" overrides a missing ct-follow:copy/,
    ],
    [
      'a travel override with an anchor point',
      (animation) => {
        animation.layers.find(({ nm }) => nm === 'ct-travel#rim,platform').ks.a = { a: 0, k: [5, 0, 0] };
      },
      /"ct-travel#rim,platform" must have no anchor point/,
    ],
    [
      'a ct-actor that is not a precomposition',
      (animation) => {
        animation.layers.find(({ nm }) => nm === 'ct-actor').ty = 3;
      },
      /ct-actor must be a precomposition/,
    ],
    [
      'a moved ct-band',
      (animation) => {
        animation.layers.find(({ nm }) => nm === 'ct-band').ks.p = { a: 0, k: [10, 0, 0] };
      },
      /ct-band must not be moved, scaled or rotated/,
    ],
    [
      'a ct-band without a rectangle',
      (animation) => {
        animation.layers.find(({ nm }) => nm === 'ct-band').shapes = [];
      },
      /ct-band must be a shape layer with a static rectangle/,
    ],
    [
      'ct:restore before ct:entry',
      (animation) => {
        ctMarker(animation, 'ct:restore').tm = 200;
      },
      /ct:restore comes before ct:entry/,
    ],
    [
      'a static track',
      (_animation, layers) => {
        layers.find(({ nm }) => nm === 'ct-track:head-free').ks.p = { a: 0, k: [0, 0, 0] };
      },
      /ct-track:head-free must have keyframed positions/,
    ],
    [
      'a parented track',
      (_animation, layers) => {
        layers.find(({ nm }) => nm === 'ct-track:sled').parent = 1;
      },
      /ct-track:sled must be an unparented null/,
    ],
    [
      'a parented reference',
      (animation) => {
        animation.layers.find(({ nm }) => nm === 'anchor:stance').parent = 900;
      },
      /anchor:stance must be an unparented null with a static position/,
    ],
    [
      'a stretch that does not meet a bind',
      (animation) => {
        animation.markers.find(({ cm, tm }) => cm === 'ct:bind:entry-edge' && tm === 0).dr = 0.5;
      },
      /the stretch at frame 1 does not lie between two binds/,
    ],
    [
      'a bind with no reference null',
      (animation) => {
        animation.markers.find(({ cm, tm }) => cm === 'ct:bind:entry-edge' && tm === 3045).cm = 'ct:bind:exit-edge';
      },
      /ct:bind:exit-edge has no anchor:exit-edge reference/,
    ],
    [
      'span references authored toward -x',
      (animation) => {
        const start = animation.layers.find(({ nm }) => nm === 'anchor:span-start');
        const end = animation.layers.find(({ nm }) => nm === 'anchor:span-end');
        [start.ks.p, end.ks.p] = [end.ks.p, start.ks.p];
      },
      /the "ledge-card" span references are not authored toward \+x/,
    ],
    [
      'a reference card without a rectangle',
      (_animation, layers) => {
        layers.find(({ nm }) => nm === 'ct-if:copy card-ref').shapes = [];
      },
      /ct-if:copy card-ref must hold a static rectangle/,
    ],
    [
      'a copy without a keyframe at ct:entry',
      (_animation, layers) => {
        const copy = layers.find(({ nm }) => nm === 'ct-track:copy');
        for (const key of ['p', 'r', 'o']) copy.ks[key].k = copy.ks[key].k.filter(({ t }) => t !== 240);
      },
      /ct-track:copy has no keyframe at ct:entry in "ledge-card"/,
    ],
    [
      'markers that are not a list',
      (animation) => {
        animation.markers = {};
      },
      /markers is not a list/,
    ],
  ])
    it(`rejects a SnowmanDelivery animation with ${name}`, () => {
      const { status, output } = check(editSnowman(edit), SNOWMAN_PACK);
      assert.equal(status, 1);
      assert.match(output, message);
    });

  for (const [name, edit] of [
    [
      'a travel keyframe on the end of the last bind',
      (animation) => {
        animation.markers.find(({ cm, tm }) => cm === 'ct:bind:entry-edge' && tm === 1476).dr = 24;
      },
    ],
    [
      'a resting copy keyframe outside every range',
      (_animation, layers) => {
        const copy = layers.find(({ nm }) => nm === 'ct-track:copy');
        for (const key of ['p', 'r', 'o']) {
          const keys = copy.ks[key].k;
          const previous = [...keys].reverse().find(({ t }) => t < 1550);
          keys.push({ ...previous, t: 1550, h: 1 });
          keys.sort((a, b) => a.t - b.t);
        }
      },
    ],
  ])
    it(`accepts a SnowmanDelivery animation with ${name}`, () => {
      const { status, output } = check(editSnowman(edit), SNOWMAN_PACK);
      assert.equal(status, 0, output);
    });
});

describe('composer carry', () => {
  for (const [name, edit, message] of [
    ['missing carrier', (a) => { a.layers = a.layers.filter(({ nm }) => nm !== 'composer-carry'); }, /needs exactly one composer-carry null/],
    ['duplicate decoration', (a) => { a.layers.push(structuredClone(carrySlot(a, 'composer-decoration'))); }, /needs exactly one composer-decoration null/],
    ['shape carrier', (_a, c) => { c.ty = 4; }, /needs exactly one composer-carry null/],
    ['fractional slot index', (_a, c) => { c.ind = 1.5; }, /identity transform/],
    ['nonzero anchor', (_a, c) => { c.ks.a.k[0] = 1; }, /identity transform/],
    ['animated scale', (_a, c) => { c.ks.s = { a: 1, k: [{ t: 0, s: [100, 100, 100], h: 1 }] }; }, /identity transform/],
    ['rotation', (_a, c) => { c.ks.r = { a: 0, k: 1 }; }, /identity transform/],
    ['skew', (_a, c) => { c.ks.sk = { a: 0, k: 1 }; }, /identity transform/],
    ['auto orientation', (_a, c) => { c.ao = 1; }, /identity transform/],
    ['shifted start', (_a, c) => { c.st = 1; }, /identity transform/],
    ['time stretch', (_a, c) => { c.sr = 2; }, /identity transform/],
    ['time remap', (_a, c) => { c.tm = { a: 0, k: 0 }; }, /identity transform/],
    ['parented carrier', (a, c) => { c.parent = carrySlot(a, 'composer-decoration').ind; }, /opaque unparented root/],
    ['transparent carrier', (_a, c) => { c.ks.o.k = 99; }, /opaque unparented root/],
    ['moved decoration', (a) => { carrySlot(a, 'composer-decoration').ks.p.k[0] = 1; }, /stationary direct child/],
    ['indirect decoration', (a) => { carrySlot(a, 'composer-decoration').parent = carrySlot(a, 'composer-side').ind; }, /stationary direct child/],
    ['duplicate indices', (a, c) => { a.layers.find(({ ty }) => ty === 4).ind = c.ind; }, /duplicate layer indices/],
    ['unparented artwork', (a) => { delete a.layers.find(({ ty }) => ty === 4).parent; }, /must descend from composer-carry/],
    ['missing parent', (a) => { a.layers.find(({ ty }) => ty === 4).parent = 999; }, /must descend from composer-carry/],
    ['parent cycle', (a) => { const layer = a.layers.find(({ ty }) => ty === 4); layer.parent = layer.ind; }, /must descend from composer-carry/],
    ['nonzero in point', (a) => { a.ip = 1; }, /timeline starting at zero/],
    ['excess duration', (a) => { a.op = 1800; }, /at most 29750 ms/],
    ['static carry position', (_a, c) => { c.ks.p = { a: 0, k: [0, 0, 0] }; }, /2\.\.64 keyframes/],
    ['one carry key', (_a, c) => { c.ks.p.k = c.ks.p.k.slice(0, 1); }, /2\.\.64 keyframes/],
    ['too many carry keys', (a, c) => { c.ks.p.k = Array.from({ length: 65 }, (_, i) => ({ t: i * a.op / 64, s: [0, 0, 0], h: 1 })); }, /2\.\.64 keyframes/],
    ['unordered carry times', (_a, c) => { c.ks.p.k[1].t = 0; }, /invalid keyframe/],
    ['nonfinite carry value', (_a, c) => { c.ks.p.k[1].s[0] = Infinity; }, /invalid keyframe/],
    ['out-of-range carry value', (_a, c) => { c.ks.p.k[1].s[0] = 1001; }, /invalid keyframe/],
    ['vertical travel', (_a, c) => { c.ks.p.k[1].s[1] = 1; }, /invalid keyframe/],
    ['spatial tangent', (_a, c) => { c.ks.p.k[1].to = [1, 0, 0]; }, /invalid keyframe/],
    ['end value', (_a, c) => { c.ks.p.k[1].e = [0, 0, 0]; }, /invalid keyframe/],
    ['invalid hold', (_a, c) => { c.ks.p.k[1].h = 2; }, /invalid keyframe/],
    ['missing paired easing', (_a, c) => { c.ks.p.k[1].o = { x: 0.3, y: 0 }; delete c.ks.p.k[1].i; }, /finite cubic curves/],
    ['out-of-range later curve component', (_a, c) => { c.ks.p.k[1].o = { x: [0.3, 2], y: [0, 0] }; }, /finite cubic curves/],
    ['empty curve array', (_a, c) => { c.ks.p.k[1].o = { x: [], y: [] }; }, /finite cubic curves/],
    ['moving start', (_a, c) => { c.ks.p.k[0].s[0] = 1; }, /start and end at rest/],
    ['early last key', (_a, c) => { c.ks.p.k.at(-1).t -= 1; }, /start and end at rest/],
    ['moving end', (_a, c) => { c.ks.p.k.at(-1).s[0] = 1; }, /start and end at rest/],
    ['duplicate side', (a) => { a.layers.push(structuredClone(carrySlot(a, 'composer-side'))); }, /needs exactly one composer-side null/],
    ['transparent side', (a) => { carrySlot(a, 'composer-side').ks.o.k = 0; }, /opaque direct child/],
    ['indirect side', (a) => { carrySlot(a, 'composer-side').parent = carrySlot(a, 'composer-decoration').ind; }, /opaque direct child/],
    ['side outside rectangle', (a) => { carrySlot(a, 'composer-side').ks.p.k[0].s = [1.1, 0.5, 0]; }, /invalid keyframe/],
    ['side vertical range', (a) => { carrySlot(a, 'composer-side').ks.p = { a: 0, k: [0, -0.1, 0] }; }, /within the composer bounds/],
    ['empty side track', (a) => { carrySlot(a, 'composer-side').ks.p.k = []; }, /1\.\.64 keyframes/],
    ['unordered side track', (a) => { const keys = carrySlot(a, 'composer-side').ks.p.k; keys[1].t = keys[0].t; }, /invalid keyframe/],
    ['side later curve component', (a) => { const key = carrySlot(a, 'composer-side').ks.p.k[0]; key.o = { x: [0, 2], y: [0, 0] }; key.i = { x: 1, y: 1 }; }, /finite cubic curves/],
  ]) it(`rejects ${name}`, () => {
    const { status, output } = check(editCarry(edit), CARRY_PACK);
    assert.equal(status, 1, output);
    assert.match(output, message);
  });

  for (const [name, edit] of [
    ['linear carry keys and zero spatial tangents', (_a, c) => {
      c.ks.p.k.forEach((key) => { delete key.o; delete key.i; key.to = [0, 0, 0]; key.ti = [0, 0, 0]; });
    }],
    ['static side position at the lower corner', (a) => { carrySlot(a, 'composer-side').ks.p = { a: 0, k: [-1, 1, 0] }; }],
    ['one side station', (a) => { carrySlot(a, 'composer-side').ks.p.k = [{ t: 12, s: [1, 0.5, 0], h: 1 }]; }],
    ['no optional side', (a, c) => {
      const side = carrySlot(a, 'composer-side');
      a.layers.forEach((layer) => { if (layer.parent === side.ind) layer.parent = c.ind; });
      a.layers = a.layers.filter((layer) => layer !== side);
    }],
  ]) it(`accepts ${name}`, () => {
    const { status, output } = check(editCarry(edit), CARRY_PACK);
    assert.equal(status, 0, output);
  });

  for (const [name, edit, message] of [
    ['mirroring', (s) => { s.direction = 'mirror'; }, /it needs none/],
    ['missing anchor capability', (s) => { s.requiredCapabilities = s.requiredCapabilities.filter((c) => c !== 'composer-anchor-v1'); }, /without requiring it/],
    ['another adapter', (s) => { s.requiredCapabilities.push('interaction-cat-borrow-v1'); }, /more than one interaction adapter/],
    ['bottom edge', (s) => { s.placement.edge = 'bottom'; }, /top-edge placement with poster fallback/],
    ['synthetic fallback', (s) => { s.placement.fallback = 'stage-anchor'; }, /top-edge placement with poster fallback/],
    ['variant bottom edge', (s) => { s.variants[1].placement.edge = 'bottom'; }, /variants\[1\] composer carry needs top-edge/],
    ['variant synthetic fallback', (s) => { s.variants[1].placement.fallback = 'stage-anchor'; }, /variants\[1\] composer carry needs top-edge/],
  ]) it(`rejects ${name} in the manifest`, () => {
    const { status, output } = check((_root, manifest) => edit(carryScene(manifest)), CARRY_PACK);
    assert.equal(status, 1, output);
    assert.match(output, message);
  });
});
