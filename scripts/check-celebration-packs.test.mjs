/*
 * Proves that check-celebration-packs.mjs rejects broken composer-anchor
 * placements, composer-outline slots and cat-borrow slots and markers. Each case
 * copies static/celebrations into a temporary directory, breaks one thing in
 * new-year-default@1.1.0 or halloween-default@1.0.0,
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
      /requires both interaction adapters/,
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
});
