#!/usr/bin/env node
/*
 * Validates the published celebration packs under static/celebrations before
 * they ship. It applies the same v1 rules the DIAL Chat BFF enforces when it
 * reads them (apps/chat-api/src/celebrations in epam/ai-dial-chat), plus the
 * Lottie authoring profile and this repository's retention policy, so a bad
 * pack fails review here instead of turning into a 502 in production.
 *
 * Usage: node scripts/check-celebration-packs.mjs [celebrations directory]
 * Exit code 0 when everything is valid, 1 otherwise. No dependencies.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(
  process.argv[2] ??
    join(dirname(fileURLToPath(import.meta.url)), '../static/celebrations'),
);
const KIB = 1024;

const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const ID_MAX_LENGTH = 64;
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const ASSET_ID = /^[a-z0-9][a-z0-9-]{0,95}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const LABEL_ID = /^[a-z][A-Za-z0-9]{0,63}$/;
const LOCALE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const REVISION = /^[A-Za-z0-9._-]{1,64}$/;
const PATH_SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;
/* `<scene>.<variant>.<first 16 hex of sha256>.<ext>`, or `<name>.<hash>.<ext>`. */
const HASHED_FILE = /\.([0-9a-f]{16})\.(json|svg|png|webp)$/;

const INDEX_MAX_BYTES = 64 * KIB;
const MANIFEST_MAX_BYTES = 64 * KIB;
const MAX_DEPTH = 32;
const LOTTIE_MAX_DEPTH = 64;
const MEDIA = {
  'application/json': { ext: 'json', maxBytes: 512 * KIB },
  'image/svg+xml': { ext: 'svg', maxBytes: 100 * KIB },
  'image/png': { ext: 'png', maxBytes: 100 * KIB },
  'image/webp': { ext: 'webp', maxBytes: 100 * KIB },
};
const MAX_ASSETS = 32;
const MAX_SCENES = 16;
const MAX_VARIANTS = 8;
const MAX_LOCALES = 16;
const MAX_LABEL_LENGTH = 280;
const MAX_CAPABILITIES = 16;
const MAX_LOAD_TIMEOUT_MS = 2000;
const MAX_READY_TIMEOUT_MS = 250;
const MAX_LIFETIME_MS = 32_000;
const MIN_POSTER_DURATION_MS = 1000;
/* Keep the current and the previous version; a fourth means cleanup is overdue. */
const MAX_VERSIONS_PER_PACK = 3;
/* Lottie caps raised by DIAL Chat S4 (#9223): 512 KiB and 4,000 keyframes per variant. */
const MAX_KEYFRAMES = 4000;
/* Raised from 30 by DIAL Chat S7 batch 1 (#9226) for the copy-track SnowmanDelivery. */
const MAX_LAYERS = 48;
/* The player DIAL Chat pins (`lottie-web` lottie_light). */
const MAX_LOTTIE_VERSION = [5, 13, 0];

const CAPABILITIES = new Set([
  'lottie-light-svg-v1',
  'viewport-stage-v1',
  'composer-anchor-v1',
  'interaction-composer-outline-v1',
  'interaction-cat-borrow-v1',
  'interaction-copy-track-v1',
  'interaction-composer-carry-v1',
  'interaction-history-ladder-v1',
  'interaction-button-props-v1',
  'static-poster-v1',
  'static-trigger-v1',
]);
/* Bounds of a `composer-anchor-v1` placement (celebration-lottie-authoring-profile). */
const ANCHOR_MIN_WIDTH = 120;
const ANCHOR_MIN_HEIGHT = 24;
const ANCHOR_MIN_SCALE = 0.25;
const ANCHOR_MAX_SCALE = 4;
const STAGE_MAX_SIZE = 4096;
/* Layers the `interaction-composer-outline-v1` adapter fits in DIAL Chat. */
const OUTLINE_SLOT = 'composer-outline';
const PARCEL_SLOT = 'composer-parcel';
const RENDERERS = new Set(['lottie-light-svg-v1']);
const ALIGN = new Set([
  'center',
  'top',
  'bottom',
  'top-start',
  'top-end',
  'bottom-start',
  'bottom-end',
]);
/*
 * Events DIAL Chat compiles, with their scene IDs. A pack for one of them must
 * not carry an `event` block; a scene with one of these IDs replaces the
 * bundled one, any other scene is an addition the operator may allowlist.
 * Update this table when Chat adds a compiled scene
 * (libs/celebrations/src/<event>/types).
 */
const KNOWN_EVENTS = {
  halloween: new Set([
    'spiders',
    'ghost',
    'web',
    'bats',
    'cat',
    'witches',
    'train',
    'portal',
    'ravens',
    'candy',
    'footprints',
    'skeletons',
    'cauldron',
    'mimic',
    'bowling',
    'mummy',
  ]),
  'new-year': new Set([
    'penguin-star',
    'gift-wrapping',
    'snowman-delivery',
    'reindeer-takeoff',
  ]),
};
const MANIFEST_KEYS = new Set([
  'schemaVersion',
  'packId',
  'version',
  'eventId',
  'requiredCapabilities',
  'assets',
  'labels',
  'event',
  'scenes',
]);
/* Never allowed anywhere in a manifest or the index. */
const EXCLUDED_KEYS = new Set([
  'script',
  'scripts',
  'function',
  'functions',
  'code',
  'css',
  'style',
  'styles',
  'stylesheet',
  'html',
  'font',
  'fonts',
  'selector',
  'selectors',
  'className',
  'classNames',
  'route',
  'routes',
  'url',
  'href',
  'src',
  'secretTrigger',
  'secretPhrase',
  'phrases',
  'decorBehaviors',
]);
const ABSOLUTE_URL =
  /^(?:[a-z][a-z0-9+.-]*:\/\/|\/\/|(?:data|javascript|vbscript|blob):)/i;

const errors = [];
const warnings = [];
/* Each message is kept once and nothing is returned, so a caller cannot use the result as a value. */
const report = (list, where, message) => {
  const entry = `${where}: ${message}`;
  if (!list.includes(entry)) list.push(entry);
};
const error = (where, message) => {
  report(errors, where, message);
};
const warn = (where, message) => {
  report(warnings, where, message);
};

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isInt = (value) => Number.isInteger(value);
const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (value) =>
  typeof value === 'string' && value.length <= ID_MAX_LENGTH && ID.test(value);
const depth = (value) =>
  value && typeof value === 'object'
    ? 1 + Math.max(0, ...Object.values(value).map(depth))
    : 0;
const walk = (value, visit, path = '$') => {
  visit(value, path);
  if (value && typeof value === 'object')
    for (const [key, child] of Object.entries(value))
      walk(child, visit, `${path}.${key}`);
};
const rel = (path) => relative(ROOT, path) || '.';

/* A stored path: relative, contained, and every segment a plain file name. */
const isContainedPath = (value) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.split('/').every((segment) => PATH_SEGMENT.test(segment));

const readJson = (file, maxBytes, maxDepth) => {
  const where = rel(file);
  if (!existsSync(file)) {
    error(where, 'file is missing');
    return undefined;
  }
  const bytes = readFileSync(file);
  if (bytes.length > maxBytes)
    error(where, `${bytes.length} B exceeds ${maxBytes} B`);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (cause) {
    error(where, `is not valid JSON (${cause.message})`);
    return undefined;
  }
  if (depth(value) > maxDepth) error(where, `JSON depth exceeds ${maxDepth}`);
  return { value, bytes };
};

const checkExcluded = (document, where) =>
  walk(document, (value, path) => {
    const key = path.split('.').at(-1);
    if (EXCLUDED_KEYS.has(key)) error(where, `${path} is not allowed in v1`);
    if (typeof value === 'string' && ABSOLUTE_URL.test(value))
      error(where, `${path} holds an absolute URL or a scheme`);
  });

const checkCapabilities = (list, where, path) => {
  if (!Array.isArray(list) || list.length > MAX_CAPABILITIES) {
    error(where, `${path} must list at most ${MAX_CAPABILITIES} capabilities`);
    return;
  }
  for (const capability of list)
    if (!CAPABILITIES.has(capability))
      error(where, `${path} names unknown capability ${capability}`);
};

/* ---------- Lottie authoring profile ---------- */
const ALLOWED_LAYER_TYPES = new Set([0, 3, 4]); // precomp, null, shape
/* 5.x up to the pinned player version. */
const isLottieVersionSupported = (version) => {
  const parts = String(version ?? '')
    .split('.')
    .map(Number);
  if (parts.length !== 3 || !parts.every(isInt)) return false;
  if (parts[0] !== MAX_LOTTIE_VERSION[0]) return false;
  const [, minor, patch] = parts;
  const [, maxMinor, maxPatch] = MAX_LOTTIE_VERSION;
  return minor < maxMinor || (minor === maxMinor && patch <= maxPatch);
};

/* Bounded authored contact grammar shared with Chat's button-props adapter. */
const BUTTON_PROPS = 'interaction-button-props-v1';
const checkButtonProps = (animation, where) => {
  try {
    const fail = (message) => { throw new Error(message); };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const fixed = (p, value) => p?.a === 0 && same(p.k, value);
    const { layers, op, fr } = animation;
    if (animation.ip !== 0 || op / fr > 26 || layers.length > 48) fail('invalid composition');
    const ids = layers.map(({ ind }) => ind);
    if (new Set(ids).size !== ids.length || ids.some((id) => !Number.isInteger(id))) fail('duplicate layer indices');
    const slot = (name, parent) => {
      const matches = layers.filter(({ nm }) => nm === name);
      if (matches.length !== 1) fail(`expected one ${name}`);
      const [l] = matches;
      if (l.ty !== 3 || l.parent !== parent || !fixed(l.ks?.a, [0,0,0]) || !fixed(l.ks?.s, [100,100,100]) || !fixed(l.ks?.r, 0) || l.tm != null || (l.st != null && l.st !== 0) || (l.sr != null && l.sr !== 1) || l.ks?.sk != null || l.ks?.sa != null || (l.ao != null && l.ao !== 0)) fail(`invalid ${name} transform`);
      return l;
    };
    const keys = (p, dim) => {
      if (p?.a !== 1 || !Array.isArray(p.k) || p.k.length < 2 || p.k.length > 128) fail('invalid contact track');
      p.k.forEach((k,i) => {
        if (!k || !Number.isFinite(k.t) || k.t < 0 || k.t > op || (i > 0 && k.t <= p.k[i-1].t) || !Array.isArray(k.s) || k.s.length !== dim || !k.s.every(Number.isFinite) || Object.keys(k).some((name) => !['t','s','i','o'].includes(name))) fail('invalid contact key');
        if ((k.i != null || k.o != null) && (!same(k.i,{x:[1],y:[1]}) || !same(k.o,{x:[0],y:[0]}))) fail('contact tracks must be linear');
      });
      if (p.k[0].t !== 0 || p.k.at(-1).t !== op) fail('incomplete contact track');
      return p.k;
    };
    const stage = slot('bp-stage');
    for (const layer of layers) {
      const visited = new Set(); let parent = layer.parent;
      while (parent != null) {
        if (visited.has(parent) || parent === layer.ind) fail('cyclic hierarchy');
        visited.add(parent); const ancestor = layers.find(({ind})=>ind===parent);
        if (!ancestor) fail('missing parent'); parent=ancestor.parent;
      }
      if (layer.ty===4 && !visited.has(stage.ind)) fail('art must descend from the stage');
    }
    if (!fixed(stage.ks?.p,[0,0,0]) || !fixed(stage.ks?.o,100)) fail('stage must be identity');
    const boundNames = ['bp-bounds:min', 'bp-bounds:max'];
    if (layers.some(({ nm }) => boundNames.includes(nm))) {
      const [min, max] = boundNames.map(name => {
        const layer = slot(name), point = layer.ks?.p?.k;
        if (layer.ks?.p?.a !== 0 || !Array.isArray(point) || point.length !== 3 ||
            !point.every(Number.isFinite) || point[2] !== 0 || !fixed(layer.ks?.o, 0))
          fail('invalid artwork bounds');
        return point;
      });
      if (min[0] < 0 || min[1] < 0 || max[0] > animation.w || max[1] > animation.h ||
          min[0] >= max[0] || min[1] >= max[1]) fail('artwork bounds outside composition');
    }
    const count = layers.filter(({nm})=>nm?.startsWith('bp-reference:')).length;
    if (count<1 || count>2) fail('expected one or two props');
    const allWeights=[];
    for(let n=0;n<count;n++) {
      const ref=slot(`bp-reference:${n}`).ks?.p;
      if(ref?.a!==0 || !Array.isArray(ref.k) || ref.k.length!==3 || !ref.k.every(Number.isFinite) || ref.k[2]!==0) fail('invalid reference');
      const weight=slot(`bp-weight:${n}`);
      if(!fixed(weight.ks?.p,[0,0,0])) fail('weight position must be identity');
      const w=keys(weight.ks?.o,1); allWeights.push(w);
      const prop=slot(`bp-prop:${n}`,stage.ind); const p=keys(prop.ks?.p,3),o=keys(prop.ks?.o,1);
      for(const track of [p,o,...allWeights]) if(!same(track.map(k=>k.t),w.map(k=>k.t))) fail('tracks must share key times');
      if(p.some(({s})=>s[2]!==0 || Math.abs(s[0])>animation.w || Math.abs(s[1])>animation.h) || [...w,...o].some(({s})=>s[0]<0 || s[0]>100)) fail('track outside bounds');
      const marker = kind => {
        const matches=(animation.markers??[]).filter(({cm})=>cm===`bp:${kind}:${n}`);
        if(matches.length!==1 || !Number.isFinite(matches[0].tm) || matches[0].dr!==0) fail(`invalid ${kind} marker`);
        return matches[0].tm;
      };
      const entry=marker('entry'),restore=marker('restore');
      if(entry<op*.02 || restore<=entry || restore>op-fr*.25) fail('invalid borrowing interval');
      for(const frame of [entry,restore]) {
        const i=p.findIndex(({t})=>t===frame);
        if(i<0 || !same(p[i].s,ref.k) || w[i].s[0]!==100) fail('prop must contact its reference at entry and return');
      }
      if(o.some(({t,s})=>(t<entry-fr*.2 || t>restore+fr*.2) && s[0]!==0)) fail('copy visible outside borrowing interval');
    }
    if(allWeights[0].some((_,i)=>allWeights.reduce((total,w)=>total+w[i].s[0],0)>100)) fail('overlapping contacts');
  } catch(e) { error(where, `button props: ${e.message}`); }
};

const checkLottie = (animation, playbackDurationMs, where) => {
  if (!isRecord(animation)) {
    error(where, 'Lottie data is not an object');
    return;
  }
  if (!isLottieVersionSupported(animation.v))
    error(where, `v ${animation.v} is newer than ${MAX_LOTTIE_VERSION.join('.')}`);
  const { fr, ip, op, w, h } = animation;
  if (!(fr >= 24 && fr <= 60)) error(where, `fr ${fr} is outside 24..60`);
  if (!(Number.isFinite(ip) && Number.isFinite(op) && ip >= 0 && ip < op))
    error(where, 'ip/op must be finite with 0 <= ip < op');
  if (!(w >= 1 && w <= 4096 && h >= 1 && h <= 4096))
    error(where, 'w/h must be within 1..4096');
  if (animation.ddd !== 0) error(where, 'ddd (3D layers) must be 0');
  if (animation.fonts || animation.chars)
    error(where, 'fonts and chars are not allowed');
  const precomps = new Map(
    (animation.assets ?? []).map((asset) => [asset.id, asset]),
  );
  for (const asset of animation.assets ?? [])
    if (asset.u !== undefined || asset.p !== undefined)
      error(where, `asset ${asset.id} references an image or a file`);
  let layers = 0;
  let keyframes = 0;
  let vertices = 0;
  const visitLayers = (list, scope) => {
    for (const layer of list ?? []) {
      layers++;
      if (!ALLOWED_LAYER_TYPES.has(layer.ty))
        error(where, `${scope} layer "${layer.nm}" has type ${layer.ty}`);
      if (layer.ty === 0 && !precomps.has(layer.refId))
        error(where, `${scope} precomp ${layer.refId} is missing`);
      if (layer.ef) error(where, `layer "${layer.nm}" has effects`);
      if (layer.tt || layer.masksProperties?.length)
        warn(where, `layer "${layer.nm}" uses a matte or mask; check its cost`);
    }
  };
  visitLayers(animation.layers, 'root');
  for (const asset of precomps.values())
    if (asset.layers) visitLayers(asset.layers, `precomp ${asset.id}`);
  walk(animation, (value, path) => {
    const key = path.split('.').at(-1);
    if (key === 'x' && typeof value === 'string')
      error(where, `${path} is an expression`);
    if (typeof value === 'string' && value.startsWith('data:'))
      error(where, `${path} embeds a data URI`);
    if (isRecord(value)) {
      if (value.a === 1 && Array.isArray(value.k)) keyframes += value.k.length;
      if (Array.isArray(value.v) && Array.isArray(value.i))
        vertices += value.v.length;
    }
  });
  if (layers > MAX_LAYERS) error(where, `${layers} layers exceed ${MAX_LAYERS}`);
  if (keyframes > MAX_KEYFRAMES) error(where, `${keyframes} keyframes exceed ${MAX_KEYFRAMES}`);
  if (vertices > 8000) error(where, `${vertices} vertices exceed 8000`);
  if (Number.isFinite(fr) && fr > 0 && Number.isFinite(op - ip)) {
    const authoredMs = ((op - ip) / fr) * 1000;
    if (Math.abs(authoredMs - playbackDurationMs) > 1000 / fr)
      error(
        where,
        `composition lasts ${Math.round(authoredMs)} ms but the scene declares playbackDurationMs ${playbackDurationMs}`,
      );
  }
};

/* ---------- Static SVG ---------- */
const checkSvg = (bytes, where) => {
  const text = bytes.toString('utf8');
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/.test(text))
    error(where, 'does not start with an <svg> root');
  if (/<script[\s>]/i.test(text)) error(where, 'contains <script>');
  if (/<foreignObject[\s>]/i.test(text)) error(where, 'contains <foreignObject>');
  if (/\son[a-z]+\s*=/i.test(text)) error(where, 'contains an event handler attribute');
  if (/(?:xlink:)?href\s*=\s*["'](?!#)/i.test(text))
    error(where, 'references an external resource');
  if (/url\(\s*["']?(?!#)/i.test(text)) error(where, 'uses a non-fragment url()');
  if (/<style[\s>]/i.test(text)) warn(where, 'contains <style>; prefer attributes');
};

/* ---------- Manifest ---------- */
const checkTiming = (scene, where, path) => {
  const timing = scene.timing ?? {};
  const { playbackDurationMs, loadTimeoutMs, readyTimeoutMs, maxLifetimeMs } =
    timing;
  if (
    ![playbackDurationMs, loadTimeoutMs, readyTimeoutMs, maxLifetimeMs].every(
      (value) => isInt(value) && value > 0,
    )
  ) {
    error(where, `${path}.timing needs four positive integers`);
    return false;
  }
  if (loadTimeoutMs > MAX_LOAD_TIMEOUT_MS)
    error(where, `${path}.timing.loadTimeoutMs exceeds ${MAX_LOAD_TIMEOUT_MS}`);
  if (readyTimeoutMs > MAX_READY_TIMEOUT_MS)
    error(where, `${path}.timing.readyTimeoutMs exceeds ${MAX_READY_TIMEOUT_MS}`);
  if (maxLifetimeMs > MAX_LIFETIME_MS)
    error(where, `${path}.timing.maxLifetimeMs exceeds ${MAX_LIFETIME_MS}`);
  if (maxLifetimeMs < loadTimeoutMs + readyTimeoutMs + playbackDurationMs)
    error(where, `${path}.timing.maxLifetimeMs is below load + ready + playback`);
  if (
    !isInt(scene.posterDurationMs) ||
    scene.posterDurationMs < MIN_POSTER_DURATION_MS ||
    scene.posterDurationMs > maxLifetimeMs
  )
    error(where, `${path}.posterDurationMs must be within 1000..maxLifetimeMs`);
  return true;
};

const checkPlacement = (placement, where, path) => {
  if (!isRecord(placement) || !isId(placement.template)) {
    error(where, `${path}.template is invalid`);
    return;
  }
  if (placement.template === 'viewport-stage-v1') {
    if (!['contain', 'cover'].includes(placement.fit))
      error(where, `${path}.fit must be contain or cover`);
    if (!ALIGN.has(placement.align)) error(where, `${path}.align is invalid`);
  } else if (placement.template === 'composer-anchor-v1') {
    checkComposerAnchor(placement, where, path);
  } else if (!CAPABILITIES.has(placement.template))
    error(where, `${path}.template ${placement.template} is unknown`);
};

const isFiniteNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value);

/* Mirrors the BFF's validation of the same fields. */
const checkComposerAnchor = (placement, where, path) => {
  const { anchor, anchorRect, edge, scale, fallback } = placement;
  if (anchor !== 'composer') error(where, `${path}.anchor must be composer`);
  const { x, y, width, height } = isRecord(anchorRect) ? anchorRect : {};
  if (
    ![x, y, width, height].every(isFiniteNumber) ||
    width < ANCHOR_MIN_WIDTH ||
    height < ANCHOR_MIN_HEIGHT ||
    x < 0 ||
    y < 0 ||
    x + width > STAGE_MAX_SIZE ||
    y + height > STAGE_MAX_SIZE
  )
    error(
      where,
      `${path}.anchorRect needs finite x, y and width >= ${ANCHOR_MIN_WIDTH}, height >= ${ANCHOR_MIN_HEIGHT} inside ${STAGE_MAX_SIZE}`,
    );
  if (!['top', 'bottom'].includes(edge))
    error(where, `${path}.edge must be top or bottom`);
  const { min, max } = isRecord(scale) ? scale : {};
  if (
    !isFiniteNumber(min) ||
    !isFiniteNumber(max) ||
    min < ANCHOR_MIN_SCALE ||
    min > max ||
    max > ANCHOR_MAX_SCALE
  )
    error(
      where,
      `${path}.scale needs ${ANCHOR_MIN_SCALE} <= min <= max <= ${ANCHOR_MAX_SCALE}`,
    );
  if (!['stage-anchor', 'poster'].includes(fallback))
    error(where, `${path}.fallback must be stage-anchor or poster`);
};

/* The anchorRect must lie inside the composition it is authored in. */
const checkAnchorInsideStage = (animation, placement, where) => {
  const { x, y, width, height } = placement.anchorRect ?? {};
  if (
    [x, y, width, height].every(isFiniteNumber) &&
    (x + width > animation.w || y + height > animation.h)
  )
    error(where, `anchorRect lies outside the ${animation.w} x ${animation.h} stage`);
};

/* ---------- interaction-composer-outline-v1 slots ---------- */
const isStatic = (property) => property === undefined || property?.a === 0;
const isStaticValue = (property, expected) => {
  if (property === undefined) return true;
  if (property?.a !== 0) return false;
  const value = Array.isArray(property.k) ? property.k : [property.k];
  return expected.every((number, index) => (value[index] ?? 0) === number);
};
/* Geometry comes from the slot's own shape: nothing above it may move, scale, rotate or skew it. */
const isIdentity = (transform) =>
  transform === undefined ||
  (isStaticValue(transform.a, [0, 0]) &&
    isStaticValue(transform.p, [0, 0]) &&
    isStaticValue(transform.s, [100, 100]) &&
    isStaticValue(transform.r, [0]) &&
    isStaticValue(transform.sk, [0]));
const collectShapes = (shapes, ty) => {
  const found = [];
  for (const shape of shapes ?? []) {
    if (shape.ty === ty) found.push(shape);
    if (shape.ty === 'tr' && !isIdentity(shape)) return undefined;
    if (shape.ty === 'gr') {
      const nested = collectShapes(shape.it, ty);
      if (!nested) return undefined;
      found.push(...nested);
    }
  }
  return found;
};
const checkSlot = (layer, ty, isGeometryStatic, where) => {
  if (layer.ty !== 4 || !isIdentity(layer.ks)) {
    error(where, `${layer.nm} must be a shape layer with an identity transform`);
    return;
  }
  const shapes = collectShapes(layer.shapes, ty);
  if (!shapes || shapes.length !== 1) {
    error(where, `${layer.nm} needs exactly one ${ty} under identity groups`);
    return;
  }
  if (!isGeometryStatic(shapes[0]))
    error(where, `${layer.nm} ${ty} must not be animated`);
};

/* The same rules DIAL Chat applies before playback; a broken slot there means a poster instead of the scene. */
const checkComposerOutlineSlots = (animation, where) => {
  const layers = animation.layers ?? [];
  const outlines = layers.filter(({ nm }) => nm === OUTLINE_SLOT);
  const parcels = layers.filter(({ nm }) => nm === PARCEL_SLOT);
  if (outlines.length !== 1)
    error(where, `needs exactly one top-level ${OUTLINE_SLOT} layer, found ${outlines.length}`);
  else checkSlot(outlines[0], 'sh', (shape) => isStatic(shape.ks), where);
  if (parcels.length > 1)
    error(where, `has ${parcels.length} ${PARCEL_SLOT} layers; at most one is allowed`);
  else if (parcels.length === 1)
    checkSlot(parcels[0], 'rc', (shape) => isStatic(shape.p) && isStatic(shape.s), where);
};

/* ---------- interaction-composer-carry-v1 slots and travel ---------- */
/* Mirrors Chat's composer-carry-adapter before the measured anchor is injected. */
const COMPOSER_CARRY = 'interaction-composer-carry-v1';
const CARRY_SLOT = 'composer-carry';
const DECORATION_SLOT = 'composer-decoration';
const SIDE_SLOT = 'composer-side';
const MAX_CARRY_KEYS = 64;

/* Carry slots use three-dimensional vectors even though all motion is 2D. */
const isCarryStaticValue = (property, expected) => {
  if (property == null) return true;
  const values = Array.isArray(property.k) ? property.k : [property.k];
  return property.a === 0 && expected.every((value, index) => values[index] === value);
};

const isCarryCurve = (curve) => {
  if (!isRecord(curve)) return false;
  const x = Array.isArray(curve.x) ? curve.x : [curve.x];
  const y = Array.isArray(curve.y) ? curve.y : [curve.y];
  return x.length > 0 && y.length > 0 &&
    x.every((value) => Number.isFinite(value) && value >= 0 && value <= 1) &&
    y.every(Number.isFinite);
};

const checkCarryPosition = (position, end, side, where) => {
  const slot = side ? SIDE_SLOT : CARRY_SLOT;
  const validValue = (value) => Array.isArray(value) && value.length === 3 &&
    value.every(Number.isFinite) && value[2] === 0 &&
    (side
      ? value[0] >= -1 && value[0] <= 1 && value[1] >= 0 && value[1] <= 1
      : value[0] >= 0 && value[0] <= 1000 && value[1] === 0);
  if (side && position?.a === 0) {
    if (!validValue(position.k)) error(where, `${slot} position must stay within the composer bounds`);
    return;
  }
  const keys = position?.k;
  if (position?.a !== 1 || !Array.isArray(keys) || keys.length < (side ? 1 : 2) || keys.length > MAX_CARRY_KEYS) {
    error(where, `${slot} position needs ${side ? '1' : '2'}..${MAX_CARRY_KEYS} keyframes`);
    return;
  }
  for (const [index, key] of keys.entries()) {
    if (!isRecord(key) || !Number.isFinite(key.t) || key.t < 0 || key.t > end ||
      (index > 0 && key.t <= keys[index - 1]?.t) || !validValue(key.s) ||
      (key.h != null && key.h !== 0 && key.h !== 1) || 'e' in key ||
      (key.to != null && JSON.stringify(key.to) !== '[0,0,0]') ||
      (key.ti != null && JSON.stringify(key.ti) !== '[0,0,0]')) {
      error(where, `${slot} position has an invalid keyframe`);
      continue;
    }
    if ((key.o != null || key.i != null) && (!isCarryCurve(key.o) || !isCarryCurve(key.i)))
      error(where, `${slot} easing must be finite cubic curves`);
  }
  if (!side && (keys[0]?.t !== 0 || keys[0]?.s?.[0] !== 0 || keys.at(-1)?.t !== end || keys.at(-1)?.s?.[0] !== 0))
    error(where, `${slot} must start and end at rest at the composition bounds`);
};

const checkComposerCarry = (animation, where) => {
  const duration = animation.op / animation.fr * 1000;
  if (animation.ip !== 0 || !Number.isFinite(duration) || duration <= 0 || duration > 29750)
    error(where, 'composer carry needs a timeline starting at zero and lasting at most 29750 ms');
  const layers = animation.layers ?? [];
  const requireSlot = (name, optional = false) => {
    const matches = layers.filter(({ nm }) => nm === name);
    if (optional && matches.length === 0) return undefined;
    if (matches.length !== 1 || matches[0].ty !== 3) {
      error(where, `needs exactly one ${name} null`);
      return undefined;
    }
    const layer = matches[0];
    if (!Number.isInteger(layer.ind) ||
      !isCarryStaticValue(layer.ks?.a, [0, 0, 0]) ||
      !isCarryStaticValue(layer.ks?.s, [100, 100, 100]) ||
      !isCarryStaticValue(layer.ks?.r, [0]) ||
      !isCarryStaticValue(layer.ks?.sk, [0]) ||
      (layer.ao != null && layer.ao !== 0) ||
      (layer.st != null && layer.st !== 0) ||
      (layer.sr != null && layer.sr !== 1) || layer.tm != null)
      error(where, `${name} must have an identity transform`);
    return layer;
  };
  const carry = requireSlot(CARRY_SLOT);
  const decoration = requireSlot(DECORATION_SLOT);
  const side = requireSlot(SIDE_SLOT, true);
  if (!carry || !decoration) return;
  if (carry.parent != null || !isCarryStaticValue(carry.ks?.o, [100]))
    error(where, `${CARRY_SLOT} must be an opaque unparented root`);
  if (decoration.parent !== carry.ind || !isCarryStaticValue(decoration.ks?.p, [0, 0, 0]))
    error(where, `${DECORATION_SLOT} must be a stationary direct child of the carrier`);
  const byIndex = new Map(layers.map((layer) => [layer.ind, layer]));
  if (byIndex.size !== layers.length) error(where, 'composer carry has duplicate layer indices');
  for (const layer of layers) {
    if (layer === carry) continue;
    let current = layer;
    for (let depth = 0; current && current !== carry && depth < layers.length; depth++)
      current = byIndex.get(current.parent);
    if (current !== carry) error(where, `layer "${layer.nm}" must descend from ${CARRY_SLOT}`);
  }
  checkCarryPosition(carry.ks?.p, animation.op, false, where);
  if (side) {
    if (side.parent !== carry.ind || !isCarryStaticValue(side.ks?.o, [100]))
      error(where, `${SIDE_SLOT} must be an opaque direct child of the carrier`);
    checkCarryPosition(side.ks?.p, animation.op, true, where);
  }
};

/* ---------- interaction-cat-borrow-v1 slots and markers ---------- */
/* The same rules DIAL Chat's adapter applies before playback (libs/celebrations
   cat-borrow-adapter, lottie-markers, lottie-anchor-binding, lottie-track-keyframes,
   lottie-time-remap). Any of them failing there means the poster instead of the
   scene, so each one is an error here. */
const CAT_BORROW = 'interaction-cat-borrow-v1';
const CAT_ANCHORS = ['entry-edge', 'perch', 'prize-0', 'prize-1', 'move', 'exit-edge'];
const CAT_SECTIONS = ['two-prizes', 'one-prize', 'crossing'];
const CAT_PRIZES = ['0', '1'];
const CAT_KINDS = {
  section: { args: CAT_SECTIONS, duration: true },
  branch: { args: ['one-prize'], duration: false },
  bind: { args: CAT_ANCHORS, duration: true, exclusive: true },
  entry: { args: CAT_PRIZES, duration: false },
  contact: { args: CAT_PRIZES, duration: false, max: 4 },
  release: { args: CAT_PRIZES, duration: false },
  landing: { args: CAT_PRIZES },
  restore: { duration: false },
};
const CAT_ORDER = ['entry', 'contact', 'release', 'landing', 'restore'];
/* The story Chat plays for 0, 1 and 2 reachable buttons. */
const CAT_STORIES = ['crossing', 'one-prize', 'two-prizes'];
/* The copy may hide its original no earlier than this share of the story. */
const CAT_MIN_HIDE_SHARE = 0.01;

const isZeroTangent = (value) => value === undefined || (Array.isArray(value) && value.every((n) => n === 0));
/* A point Chat reads as static: present, not animated (`a === 0` when `requireZero`) and numeric. */
const isStaticPoint = (property, requireZero = false) =>
  isRecord(property) &&
  (requireZero ? property.a === 0 : property.a !== 1) &&
  Array.isArray(property.k) &&
  property.k.length >= 2 &&
  property.k.every(isFiniteNumber);
/* DIAL Chat's `easingOf` (lottie-track-keyframes): holds step, missing or straight tangents are
   linear, and the curve compares at four decimals. `undefined` for a tangent that is not numeric. */
const easingOf = (keyframe) => {
  if (keyframe.h === 1) return 'steps(1, end)';
  if (!keyframe.o || !keyframe.i) return 'linear';
  const curve = [keyframe.o.x, keyframe.o.y, keyframe.i.x, keyframe.i.y].map((value) =>
    Array.isArray(value) ? value[0] : value,
  );
  if (!curve.every(isFiniteNumber)) return undefined;
  const [ox, oy, ix, iy] = curve.map((value) => Number(value.toFixed(4)));
  return ox === oy && ix === iy ? 'linear' : `cubic-bezier(${[ox, oy, ix, iy].join(', ')})`;
};
const findCatMarker = (markers, kind, arg) =>
  markers.find((marker) => marker.kind === kind && marker.arg === arg);

/* Returns the valid `cat:` markers grouped by section, as DIAL Chat's `readNamespacedMarkers` does. */
const readCatMarkers = (animation, rigEnd, where) => {
  const raw = animation.markers;
  if (raw !== undefined && !Array.isArray(raw)) {
    error(where, 'markers is not a list');
    return [];
  }
  const list = [];
  for (const marker of raw ?? []) {
    if (!isRecord(marker) || typeof marker.cm !== 'string' || !marker.cm.startsWith('cat:')) continue;
    const label = marker.cm;
    const [, kind, arg, ...rest] = label.split(':');
    const rule = Object.hasOwn(CAT_KINDS, kind) ? CAT_KINDS[kind] : undefined;
    if (!rule || rest.length) {
      error(where, `marker ${label} is unknown`);
      continue;
    }
    if (rule.args ? !rule.args.includes(arg) : arg !== undefined) {
      error(where, `marker ${label} has an unknown argument`);
      continue;
    }
    const { tm } = marker;
    const dr = marker.dr ?? 0;
    if (
      !isFiniteNumber(tm) ||
      !isFiniteNumber(dr) ||
      dr < 0 ||
      tm < 0 ||
      tm + dr > rigEnd ||
      (dr === 0 && tm >= rigEnd)
    ) {
      error(where, `marker ${label} lies outside the rig timeline 0..${rigEnd}`);
      continue;
    }
    if (rule.duration === true && !(dr > 0)) {
      error(where, `marker ${label} needs a duration`);
      continue;
    }
    if (rule.duration === false && dr > 0) {
      error(where, `marker ${label} must not have a duration`);
      continue;
    }
    list.push({ kind, arg, tm, dr, label });
  }
  list.sort((a, b) => a.tm - b.tm);

  const sections = list.filter(({ kind }) => kind === 'section');
  if (!sections.length) error(where, 'has no cat:section marker');
  const sectionLabels = new Set();
  sections.forEach((section, index) => {
    if (sectionLabels.has(section.label)) error(where, `${section.label} repeats in the timeline`);
    sectionLabels.add(section.label);
    const next = sections[index + 1];
    if (next && next.tm < section.tm + section.dr) error(where, `${section.label} overlaps ${next.label}`);
  });
  const scopes = sections.map((section) => ({ section, markers: [] }));
  for (const marker of list) {
    if (marker.kind === 'section') continue;
    const fits = ({ section }) => marker.tm >= section.tm && marker.tm + marker.dr <= section.tm + section.dr;
    /* Sections are half-open: a marker on a shared boundary belongs to the section it opens. */
    const scope = scopes.find((s) => fits(s) && marker.tm < s.section.tm + s.section.dr) ?? scopes.find(fits);
    if (!scope) error(where, `marker ${marker.label} lies outside every section`);
    else scope.markers.push(marker);
  }
  for (const { section, markers } of scopes) {
    const counts = new Map();
    for (const marker of markers) {
      const key = `${marker.kind}:${marker.arg ?? ''}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (counts.get(key) > (CAT_KINDS[marker.kind].max ?? 1))
        error(where, `marker ${marker.label} repeats in ${section.label}`);
    }
    const binds = markers.filter(({ kind }) => kind === 'bind');
    binds.forEach((first, i) => {
      for (const second of binds.slice(i + 1))
        if (first.tm < second.tm + second.dr && second.tm < first.tm + first.dr)
          error(where, `${first.label} overlaps ${second.label} in ${section.label}`);
    });
    CAT_ORDER.forEach((earlier, i) => {
      for (const later of CAT_ORDER.slice(i + 1))
        for (const a of markers.filter(({ kind }) => kind === earlier))
          for (const b of markers.filter(({ kind }) => kind === later))
            if ((a.arg === b.arg || a.arg === undefined || b.arg === undefined) && b.tm < a.tm)
              error(where, `${b.label} comes before ${a.label} in ${section.label}`);
    });
    for (const branch of markers.filter(({ kind }) => kind === 'branch')) {
      const release = findCatMarker(markers, 'release', '0');
      if (!release || release.tm !== branch.tm)
        error(where, `${branch.label} must share its frame with cat:release:0 in ${section.label}`);
    }
  }
  return scopes;
};

/* The ranges and markers DIAL Chat's `pathFor` plays for `count` borrowed buttons, or `undefined`. */
const catPath = (scopes, count) => {
  const scope = (name) => scopes.find(({ section }) => section.arg === name);
  const whole = ({ section, markers }) => ({
    ranges: [{ from: section.tm, to: section.tm + section.dr }],
    markers,
  });
  const two = scope('two-prizes');
  const one = scope('one-prize');
  if (count >= 2 && two) return whole(two);
  if (count === 1 && one) {
    const branch = two && findCatMarker(two.markers, 'branch', 'one-prize');
    if (!branch) return whole(one);
    return {
      ranges: [{ from: two.section.tm, to: branch.tm }, ...whole(one).ranges],
      markers: [...two.markers.filter(({ tm }) => tm < branch.tm), ...one.markers],
    };
  }
  const crossing = scope('crossing');
  return count === 0 && crossing ? whole(crossing) : undefined;
};

/* The story frame at which rig frame `local` shows, or `undefined` when the story skips it. */
const toStoryFrame = (ranges, local) => {
  let start = 0;
  for (const { from, to } of ranges) {
    if (local >= from && local <= to) return start + local - from;
    start += to - from;
  }
  return undefined;
};

/* Every story Chat may choose must carry the markers it reads for that story. */
const checkCatStories = (scopes, slotCount, tracks, compositionOp, where) => {
  for (let count = 0; count <= Math.min(2, slotCount); count++) {
    const path = catPath(scopes, count);
    if (!path) continue;
    const story = `the ${CAT_STORIES[count]} story`;
    if (path.ranges.some(({ from, to }) => !(to > from))) {
      error(where, `${story} has a range without length`);
      continue;
    }
    const end = path.ranges.reduce((sum, { from, to }) => sum + to - from, 0);
    if (Number.isFinite(compositionOp) && end > compositionOp)
      error(where, `${story} lasts ${end} frames, beyond the composition's op ${compositionOp}`);
    if (count === 0) continue;
    const need = (kind, arg) => {
      const marker = findCatMarker(path.markers, kind, arg);
      if (!marker) error(where, `${story} has no cat:${kind}${arg === undefined ? '' : `:${arg}`}`);
      return marker;
    };
    const restore = need('restore');
    for (let index = 0; index < count; index++) {
      const prize = String(index);
      const entry = need('entry', prize);
      const release = need('release', prize);
      if (entry && restore) {
        const hide = toStoryFrame(path.ranges, entry.tm);
        if (!(hide >= end * CAT_MIN_HIDE_SHARE && hide <= toStoryFrame(path.ranges, restore.tm)))
          error(where, `${story}: ${entry.label} must lie between 1% of the story and cat:restore`);
      }
      if (release)
        for (const { t } of tracks[prize] ?? [])
          if (t <= release.tm && toStoryFrame(path.ranges, t) === undefined)
            error(where, `${story}: prize-${prize} keyframe at frame ${t} never plays`);
    }
    const last = String(count - 1);
    const landing = need('landing', last);
    const release = findCatMarker(path.markers, 'release', last);
    if (landing?.dr > 0 && release) {
      if (!(landing.tm > release.tm))
        error(where, `${story}: ${landing.label} has an elastic range but does not come after ${release.label}`);
      else if (!path.ranges.some(({ from, to }) => release.tm >= from && landing.tm + landing.dr <= to))
        error(where, `${story}: the elastic range of ${landing.label} crosses a story step`);
    }
  }
};

/* Keyframes Chat retargets: a numeric start value and no end value each; returns those with a time. */
const stationKeyframes = (layer, key, where) => {
  const property = layer.ks?.[key];
  if (property?.a !== 1 || !Array.isArray(property.k) || !property.k.length) {
    error(where, `${layer.nm} ${key === 'p' ? 'position' : 'scale'} must be keyframed`);
    return [];
  }
  const keyframes = property.k;
  if (
    keyframes.some(
      (k) =>
        !isRecord(k) ||
        !isFiniteNumber(k.t) ||
        !Array.isArray(k.s) ||
        k.s.length < 2 ||
        !k.s.every(isFiniteNumber) ||
        'e' in k,
    )
  )
    error(where, `${layer.nm} keyframes need a numeric start value and no end value`);
  return keyframes.filter((k) => isRecord(k) && isFiniteNumber(k.t) && Array.isArray(k.s));
};

const checkCatBorrow = (animation, where) => {
  if ((animation.ip ?? 0) !== 0) error(where, 'the composition must start at frame 0');
  const rigs = (animation.layers ?? []).filter(({ nm }) => nm === 'cat-rig');
  if (rigs.length !== 1 || rigs[0].ty !== 0) {
    error(where, `needs exactly one top-level cat-rig precomposition, found ${rigs.length}`);
    return;
  }
  const [rig] = rigs;
  if (rig.tm !== undefined) error(where, 'cat-rig has its own time remap; the adapter writes it');
  if ((rig.st ?? 0) !== 0) error(where, 'cat-rig must start at frame 0');
  if (rig.parent !== undefined) error(where, 'cat-rig must not have a parent');
  if (!isStaticPoint(rig.ks?.a) || !isStaticPoint(rig.ks?.p))
    error(where, 'cat-rig anchor and position must be static points');
  /* Stage-to-rig is a pure shift only for an unscaled, unrotated rig, as the runtime requires. */
  const isIdentity = (property, identity) =>
    property === undefined ||
    (property.a !== 1 && [property.k].flat().slice(0, 2).every((value) => value === identity));
  if (!isIdentity(rig.ks?.s, 100) || !isIdentity(rig.ks?.r, 0))
    error(where, 'cat-rig scale must be 100 % and rotation 0°, unanimated');
  const layers = (animation.assets ?? []).find(({ id }) => id === rig.refId)?.layers;
  if (!Array.isArray(layers) || !layers.length) {
    error(where, 'cat-rig has no layers');
    return;
  }
  const rigEnd = Math.max(0, ...layers.map(({ op }) => op ?? 0));
  const one = (name) => {
    const found = layers.filter(({ nm }) => nm === name);
    if (found.length !== 1) error(where, `needs exactly one ${name} layer in cat-rig, found ${found.length}`);
    return found.length === 1 ? found[0] : undefined;
  };
  const root = one('cat-root');
  const facing = one('cat-facing');
  if (root && (root.ty !== 3 || root.parent !== undefined)) error(where, 'cat-root must be an unparented null');
  if (facing && facing.ty !== 3) error(where, 'cat-facing must be a null');
  const positions = root ? stationKeyframes(root, 'p', where) : [];
  if (positions.some((k) => !isZeroTangent(k.to) || !isZeroTangent(k.ti)))
    error(where, 'cat-root keyframes must have no spatial tangents');
  const facingKeys = facing ? stationKeyframes(facing, 's', where) : [];
  if (facingKeys.slice(0, -1).some(({ h }) => h !== 1)) error(where, 'cat-facing scale must be hold keyframes');

  const scopes = readCatMarkers(animation, rigEnd, where);
  const markers = scopes.flatMap((scope) => scope.markers);
  const binds = markers.filter(({ kind }) => kind === 'bind');
  /* A keyframe on a shared boundary belongs to the later range, the last one to its end. */
  const isBound = (t) =>
    binds.some(({ tm, dr }) => tm <= t && t < tm + dr) || binds.some(({ tm, dr }) => t === tm + dr);
  for (const [name, keyframes] of [
    ['cat-root', positions],
    ['cat-facing', facingKeys],
  ])
    for (const { t } of keyframes)
      if (!isBound(t)) error(where, `${name} keyframe at frame ${t} lies outside every cat:bind range`);
  for (const name of new Set(binds.map(({ arg }) => arg))) {
    const reference = layers.filter(({ nm }) => nm === `anchor:${name}`);
    if (
      reference.length !== 1 ||
      reference[0].ty !== 3 ||
      reference[0].parent !== undefined ||
      !isStaticPoint(reference[0].ks?.p, true)
    )
      error(where, `anchor:${name} must be one unparented null with a static position`);
  }

  const tracks = {};
  const slots = [];
  for (const prize of CAT_PRIZES) {
    const name = `prize-${prize}`;
    const found = layers.filter(({ nm }) => nm === name);
    if (found.length > 1) error(where, `has ${found.length} ${name} layers in cat-rig; at most one is allowed`);
    const releases = markers.filter(({ kind, arg }) => kind === 'release' && arg === prize);
    if (!releases.length) continue;
    slots.push(prize);
    const bind = findCatMarker(markers, 'bind', name);
    if (!bind) error(where, `cat:release:${prize} needs a cat:bind:${name} range`);
    else if (!positions.some(({ t }) => t >= bind.tm && t < bind.tm + bind.dr))
      error(where, `cat:bind:${name} has no cat-root keyframe inside its range at frame ${bind.tm}`);
    const [track] = found;
    if (!track) {
      error(where, `cat:release:${prize} has no ${name} layer`);
      continue;
    }
    if (track.ks?.s?.a === 1) error(where, `${name} must not animate its scale`);
    const position = track.ks?.p;
    if (position?.a !== 1 || !Array.isArray(position.k) || !position.k.length) {
      error(where, `${name} position must be keyframed`);
      continue;
    }
    const animated = ['p', 'r', 'o'].map((key) => track.ks?.[key]).filter((property) => property?.a === 1);
    if (
      animated.some(
        ({ k }) =>
          !Array.isArray(k) ||
          k.some((keyframe) => !isRecord(keyframe) || !isFiniteNumber(keyframe.t) || !isFiniteNumber(keyframe.s?.[0])),
      )
    ) {
      error(where, `${name} has a keyframe without a numeric time and start value`);
      continue;
    }
    const [reference] = animated.map(({ k }) => k);
    if (animated.some(({ k }) => k.some((keyframe) => easingOf(keyframe) === undefined)))
      error(where, `${name} has a keyframe with non-numeric easing`);
    else if (
      animated.some(
        ({ k }) =>
          k.length !== reference.length ||
          k.some((keyframe, i) => keyframe.t !== reference[i].t || easingOf(keyframe) !== easingOf(reference[i])),
      )
    )
      error(where, `${name} tracks must share keyframe times and easing`);
    for (const { tm } of releases)
      if (!reference.some(({ t }) => t === tm)) error(where, `${name} has no keyframe at its release frame ${tm}`);
    tracks[prize] = reference;
  }
  checkCatStories(scopes, slots.length, tracks, animation.op, where);

  const floors = (animation.layers ?? []).filter(({ nm }) => nm === 'cat-floor');
  if (floors.length > 1) error(where, `has ${floors.length} cat-floor layers; at most one is allowed`);
  else if (floors.length === 1) {
    const items = floors[0].shapes?.[0]?.it ?? [];
    if (
      floors[0].shapes?.length !== 1 ||
      items.filter(({ ty }) => ty === 'rc').length !== 1 ||
      items.filter(({ ty }) => ty === 'gf').length !== 1
    )
      error(where, 'cat-floor must be one group with one rectangle and one gradient fill');
  }
};

/* ---------- interaction-copy-track-v1 slots, markers and references ---------- */
/* The same rules DIAL Chat's adapter applies before playback (libs/celebrations
   copy-track-adapter, copy-track-markers, lottie-markers), plus the pose checks
   the asset needs at every splice and cycle boundary. Any of the adapter's rules
   failing there means the poster instead of the scene, so each one is an error here. */
const COPY_TRACK = 'interaction-copy-track-v1';
const CT_SECTIONS = ['ledge-card', 'rim-card', 'rim', 'platform', 'rim-word'];
const CT_COPY_SECTIONS = new Set(['ledge-card', 'rim-card', 'rim-word']);
const CT_ANCHORS = ['entry-edge', 'stance', 'copy', 'span-start', 'span-end', 'far', 'exit-edge'];
const CT_STRETCHABLE = ['span-start', 'span-end', 'far'];
const CT_CONTACTS = ['grip', 'seat', 'impact', 'lodge', 'slot', 'catch'];
const CT_SLOTS = ['0', '1', '2', '3', '4', '5', '6', '7'];
const CT_KINDS = {
  section: { args: CT_SECTIONS, duration: false },
  trunk: { duration: true },
  cut: { args: CT_SECTIONS, duration: true, max: 4 },
  fill: { args: CT_SECTIONS, duration: true, max: 4 },
  bind: { args: CT_ANCHORS, duration: true, max: 16, exclusive: true },
  stretch: { duration: true, max: 12, exclusive: true },
  cycle: { args: CT_SLOTS, duration: true },
  'cycle-window': { args: CT_SLOTS, duration: true },
  entry: { duration: false },
  restore: { duration: false },
  contact: { args: CT_CONTACTS, duration: false, max: 8 },
};
const CT_EPSILON = 1e-6;
/* Units within which two poses count as one at a splice or cycle boundary. */
const CT_POSE_TOLERANCE = 0.25;
/* Chat's `SNAPSHOT_HIDE_FADE_SHARE`: the copy fades its original in over this share before `ct:entry`. */
const SNAPSHOT_HIDE_FADE_SHARE = 0.01;
const CT_OVERRIDABLE = new Set([
  ...CT_STRETCHABLE.flatMap((anchor) => [`anchor:${anchor}`, `anchor:${anchor}@min`]),
  ...CT_ANCHORS.map((anchor) => `ct-follow:${anchor}`),
  'ct-travel',
]);

const ctEnd = ({ tm, dr }) => tm + dr;
const ctOverlaps = (a, b) => a.tm < ctEnd(b) - CT_EPSILON && b.tm < ctEnd(a) - CT_EPSILON;
const ctInside = (inner, from, to) => inner.tm >= from - CT_EPSILON && ctEnd(inner) <= to + CT_EPSILON;
const ctLabel = ({ kind, arg }) => (arg === undefined ? kind : `${kind}:${arg}`);

/* A keyframed property's value at a frame, as lottie-web evaluates linear, hold and eased segments. */
const ctBezier = (x1, y1, x2, y2, x) => {
  const sample = (a, b, t) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let step = 0; step < 50; step++) {
    if (sample(x1, x2, t) < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return sample(y1, y2, t);
};
const ctFirst = (value) => (Array.isArray(value) ? value[0] : value);
const ctValueAt = (property, frame) => {
  if (!isRecord(property)) return [0, 0];
  if (property.a !== 1) return [property.k].flat();
  const keys = property.k;
  if (!keys.length) return [0, 0];
  if (frame <= keys[0].t) return keys[0].s;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = keys[i + 1];
    if (frame >= key.t && frame < next.t) {
      if (key.h === 1) return key.s;
      const share = (frame - key.t) / (next.t - key.t);
      const eased =
        key.o && key.i
          ? ctBezier(ctFirst(key.o.x), ctFirst(key.o.y), ctFirst(key.i.x), ctFirst(key.i.y), share)
          : share;
      return key.s.map((value, dim) => value + ((next.s?.[dim] ?? value) - value) * eased);
    }
  }
  return keys[keys.length - 1].s;
};

/* Returns the valid `ct:` markers, as DIAL Chat's `readNamespacedMarkers` does. */
const readCopyTrackMarkers = (animation, actorEnd, where) => {
  const markers = [];
  if (animation.markers !== undefined && !Array.isArray(animation.markers)) {
    error(where, 'markers is not a list');
    return markers;
  }
  for (const marker of animation.markers ?? []) {
    if (!isRecord(marker) || typeof marker.cm !== 'string' || !marker.cm.startsWith('ct:')) continue;
    const [, kind, arg, ...rest] = marker.cm.split(':');
    const rule = Object.hasOwn(CT_KINDS, kind) ? CT_KINDS[kind] : undefined;
    if (!rule || rest.length || (rule.args ? !rule.args.includes(arg) : arg !== undefined)) {
      error(where, `has an unknown copy-track marker "${marker.cm}"`);
      continue;
    }
    const tm = marker.tm;
    const dr = marker.dr ?? 0;
    if (!isFiniteNumber(tm) || !isFiniteNumber(dr) || dr < 0 || tm < 0 || tm + dr > actorEnd || (dr === 0 && tm >= actorEnd)) {
      error(where, `"${marker.cm}" lies outside frames 0–${actorEnd}`);
      continue;
    }
    if (rule.duration === true && dr <= 0) error(where, `"${marker.cm}" needs a duration`);
    if (rule.duration === false && dr > 0) error(where, `"${marker.cm}" must not have a duration`);
    markers.push({ kind, arg, tm, dr });
  }
  markers.sort((a, b) => a.tm - b.tm);
  const counts = new Map();
  for (const marker of markers) {
    const key = ctLabel(marker);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (counts.get(key) === (CT_KINDS[marker.kind].max ?? 1) + 1) error(where, `"ct:${key}" repeats`);
  }
  for (const kind of Object.keys(CT_KINDS).filter((name) => CT_KINDS[name].exclusive)) {
    const ranges = markers.filter((marker) => marker.kind === kind);
    ranges.forEach((first, i) => {
      for (const second of ranges.slice(i + 1))
        if (first.tm < ctEnd(second) && second.tm < ctEnd(first))
          error(where, `"ct:${ctLabel(first)}" overlaps "ct:${ctLabel(second)}"`);
    });
  }
  return markers;
};

const checkCopyTrack = (animation, where) => {
  if ((animation.ip ?? 0) !== 0) error(where, 'the composition must start at frame 0');
  /* lottie-web can throw while interpolating from a keyframe with neither a hold nor
     an easing: the copy track's keys at a splice edge did, while the cat's tangent-free
     prize keys (see the tests) play. Chat remaps the actor into any frame, so a
     copy-track asset carries no such key. */
  walk(animation, (value, path) => {
    if (!isRecord(value) || value.a !== 1 || !Array.isArray(value.k)) return;
    const bare = value.k.slice(0, -1).find((key) => isRecord(key) && key.h !== 1 && !(key.o && key.i));
    if (bare) error(where, `${path} has a keyframe at frame ${bare.t} with neither a hold nor an easing`);
  });
  const root = animation.layers ?? [];
  const actors = root.filter(({ nm }) => nm === 'ct-actor');
  const travels = root.filter(({ nm }) => nm === 'ct-travel');
  if (actors.length !== 1) error(where, `needs exactly one top-level ct-actor precomposition, found ${actors.length}`);
  if (travels.length !== 1) error(where, `needs exactly one top-level ct-travel null, found ${travels.length}`);
  if (actors.length !== 1 || travels.length !== 1) return;
  const [actor] = actors;
  const [travel] = travels;
  if (actor.ty !== 0) error(where, 'ct-actor must be a precomposition');
  if (actor.tm !== undefined) error(where, 'ct-actor has its own time remap; the adapter writes it');
  if ((actor.st ?? 0) !== 0) error(where, 'ct-actor must start at frame 0');
  if (travel.ty !== 3 || travel.parent !== undefined) error(where, 'ct-travel must be an unparented null');
  if (travel.ind === undefined || actor.parent !== travel.ind) error(where, 'ct-actor must be parented to ct-travel');
  const isIdentity = (property, identity) =>
    property === undefined || (property.a !== 1 && [property.k].flat().slice(0, 2).every((value) => value === identity));
  for (const layer of [actor, travel])
    if (!isIdentity(layer.ks?.s, 100) || !isIdentity(layer.ks?.r, 0))
      error(where, `${layer.nm} scale must be 100 % and rotation 0°, unanimated`);
  if (!isStaticPoint(travel.ks?.a ?? { a: 0, k: [0, 0] }) || ctValueAt(travel.ks?.a, 0).slice(0, 2).some((v) => v !== 0))
    error(where, 'ct-travel must have no anchor point');
  if (!isStaticPoint(actor.ks?.a ?? { a: 0, k: [0, 0] }) || !isStaticPoint(actor.ks?.p ?? { a: 0, k: [0, 0] }))
    error(where, 'ct-actor anchor and position must be static points');
  const asset = (animation.assets ?? []).find(({ id }) => id === actor.refId);
  const layers = asset?.layers ?? [];
  if (!layers.length) {
    error(where, 'ct-actor has no layers');
    return;
  }
  const actorEnd = Math.max(...layers.map(({ op }) => op ?? 0));

  const markers = readCopyTrackMarkers(animation, actorEnd, where);
  const of = (kind) => markers.filter((marker) => marker.kind === kind);
  const sections = of('section').map(({ arg }) => arg);
  if (!sections.length) error(where, 'declares no ct:section marker');
  const trunks = of('trunk');
  if (trunks.length !== 1) {
    error(where, `needs exactly one ct:trunk marker, found ${trunks.length}`);
    return;
  }
  const trunk = { from: trunks[0].tm, to: ctEnd(trunks[0]) };
  if (trunk.to - trunk.from > animation.op + CT_EPSILON) error(where, 'the trunk is longer than the composition');
  const cuts = of('cut');
  const fills = of('fill');
  const splices = {};
  for (const kind of CT_SECTIONS) {
    const kindCuts = cuts.filter(({ arg }) => arg === kind);
    const kindFills = fills.filter(({ arg }) => arg === kind);
    if (kindCuts.length !== kindFills.length)
      error(where, `"${kind}" has ${kindCuts.length} cuts and ${kindFills.length} fills`);
    if (!kindCuts.length) continue;
    if (!sections.includes(kind)) error(where, `"${kind}" has splices but no section`);
    splices[kind] = kindCuts.slice(0, kindFills.length).map((cut, i) => {
      const fill = kindFills[i];
      if (!ctInside(cut, trunk.from, trunk.to)) error(where, `a "${kind}" cut leaves the trunk`);
      if (fill.tm < trunk.to - CT_EPSILON) error(where, `a "${kind}" fill lies inside the trunk`);
      if (Math.abs(cut.dr - fill.dr) > CT_EPSILON) error(where, `a "${kind}" fill does not last as long as its cut`);
      for (const other of kindCuts.slice(i + 1)) if (ctOverlaps(cut, other)) error(where, `two "${kind}" cuts overlap`);
      return { cut, fill };
    });
  }
  fills.forEach((fill, i) => {
    for (const other of fills.slice(i + 1))
      if (
        ctOverlaps(fill, other) &&
        (fill.arg === other.arg || Math.abs(fill.tm - other.tm) > CT_EPSILON || Math.abs(fill.dr - other.dr) > CT_EPSILON)
      )
        error(where, `fills at frames ${fill.tm} and ${other.tm} overlap`);
  });
  const binds = of('bind');
  const stretches = of('stretch');
  for (const stretch of stretches)
    for (const bind of binds) if (ctOverlaps(stretch, bind)) error(where, `a stretch at frame ${stretch.tm} overlaps a bind`);
  const cycleMarkers = of('cycle');
  const windows = of('cycle-window');
  if (cycleMarkers.length !== windows.length) error(where, 'every ct:cycle needs exactly one ct:cycle-window');
  const cycles = [];
  for (const window of windows) {
    const cycle = cycleMarkers.find(({ arg }) => arg === window.arg);
    if (!cycle) {
      error(where, `cycle window ${window.arg} has no cycle`);
      continue;
    }
    const isInTrunk = ctInside(window, trunk.from, trunk.to);
    if (!isInTrunk && !fills.some((fill) => ctInside(window, fill.tm, ctEnd(fill))))
      error(where, `cycle window ${window.arg} lies in neither the trunk nor one fill`);
    if (isInTrunk && cuts.some((cut) => ctOverlaps(cut, window) && !ctInside(window, cut.tm, ctEnd(cut))))
      error(where, `cycle window ${window.arg} crosses a cut boundary`);
    if (!ctInside(cycle, window.tm, ctEnd(window))) error(where, `cycle ${window.arg} lies outside its window`);
    cycles.push({ cycle, window });
  }
  const [entry] = of('entry');
  const [restore] = of('restore');
  const copySections = sections.filter((kind) => CT_COPY_SECTIONS.has(kind));
  if (copySections.length && (!entry || !restore))
    error(where, 'a section copies but ct:entry or ct:restore is missing');
  if (entry && restore && restore.tm < entry.tm) error(where, 'ct:restore comes before ct:entry');

  /* Slots and references, as Chat's `findLayer`, `readReferences` and `bandOf` read them. */
  const one = (list, name) => {
    const found = list.filter(({ nm }) => nm === name);
    if (found.length !== 1) error(where, `needs exactly one ${name} layer, found ${found.length}`);
    return found[0];
  };
  one(layers, 'ct-track:root');
  if (copySections.length) one(layers, 'ct-track:copy');
  const isMovedBy = (property, identity) => property !== undefined && !isIdentity(property, identity);
  const band = one(root, 'ct-band');
  if (band) {
    const items = (band.shapes ?? []).flatMap((shape) => (shape.ty === 'gr' ? shape.it ?? [] : [shape]));
    const rectangle = items.find((item) => item.ty === 'rc');
    const group = items.find((item) => item.ty === 'tr');
    if (band.ty !== 4 || !rectangle || !isStaticPoint(rectangle.p) || !isStaticPoint(rectangle.s))
      error(where, 'ct-band must be a shape layer with a static rectangle');
    if (
      [band.ks?.p, band.ks?.a, group?.p, group?.a].some((property) => isMovedBy(property, 0)) ||
      [band.ks?.s, group?.s].some((property) => isMovedBy(property, 100)) ||
      [band.ks?.r, group?.r].some((property) => isMovedBy(property, 0))
    )
      error(where, 'ct-band must not be moved, scaled or rotated');
  }
  const cardSections = sections.filter((kind) => kind.endsWith('-card'));
  if (cardSections.length) {
    const card = one(layers, 'ct-if:copy card-ref');
    const rectangle = (card?.shapes ?? [])
      .flatMap((shape) => (shape.ty === 'gr' ? shape.it ?? [] : [shape]))
      .find((item) => item.ty === 'rc');
    if (card && (!rectangle || !isStaticPoint(rectangle.s)))
      error(where, 'ct-if:copy card-ref must hold a static rectangle, the reference card');
  }
  const referenceAt = (list, name) => {
    const layer = one(list, name);
    if (!layer) return undefined;
    if (layer.ty !== 3 || layer.parent !== undefined || !isStaticPoint(layer.ks?.p)) {
      error(where, `${name} must be an unparented null with a static position`);
      return undefined;
    }
    return ctValueAt(layer.ks.p, 0);
  };
  referenceAt(root, 'anchor:stance');
  referenceAt(root, 'anchor:entry-edge');
  for (const anchor of CT_STRETCHABLE) {
    referenceAt(root, `anchor:${anchor}`);
    referenceAt(root, `anchor:${anchor}@min`);
  }

  /* Section overrides: `<base>#<kind>[,<kind>…]`. */
  const overrides = new Map();
  for (const layer of root) {
    const name = layer.nm;
    if (typeof name !== 'string' || !name.includes('#')) continue;
    const at = name.indexOf('#');
    const base = name.slice(0, at);
    const kinds = name.slice(at + 1).split(',');
    if (!CT_OVERRIDABLE.has(base)) error(where, `"${name}" overrides no reference`);
    else if (root.filter(({ nm }) => nm === base).length !== 1) error(where, `"${name}" overrides a missing ${base}`);
    for (const kind of kinds) {
      if (!sections.includes(kind)) error(where, `"${name}" names no declared section "${kind}"`);
      const key = `${base}#${kind}`;
      if (overrides.has(key)) error(where, `${base} is overridden twice for "${kind}"`);
      overrides.set(key, layer);
    }
    if (layer.ty !== 3 || layer.parent !== undefined) error(where, `"${name}" must be an unparented null`);
    if (base === 'ct-travel') {
      if (!isIdentity(layer.ks?.s, 100) || !isIdentity(layer.ks?.r, 0)) error(where, `"${name}" must not scale or rotate`);
      if (isMovedBy(layer.ks?.a, 0)) error(where, `"${name}" must have no anchor point`);
    } else if (!isStaticPoint(layer.ks?.p)) error(where, `"${name}" must have a static position`);
  }
  /* The root one section sees: its overrides replace the base layers. */
  const layerFor = (kind, name) => overrides.get(`${name}#${kind}`) ?? root.find(({ nm }) => nm === name);
  const pointFor = (kind, anchor) => {
    const layer = layerFor(kind, `anchor:${anchor}`);
    return layer && isStaticPoint(layer.ks?.p) ? ctValueAt(layer.ks.p, 0) : undefined;
  };
  for (const kind of sections) {
    const x = (anchor) => pointFor(kind, anchor)?.[0];
    if (
      !(x('span-end') > x('span-start')) ||
      !(x('span-end@min') > x('span-start@min')) ||
      !(x('span-end') > x('span-end@min'))
    )
      error(where, `the "${kind}" span references are not authored toward +x`);
  }
  for (const argument of new Set(binds.map(({ arg }) => arg)))
    if (!root.some(({ nm }) => nm === `anchor:${argument}`))
      error(where, `ct:bind:${argument} has no anchor:${argument} reference`);
  for (const stretch of stretches)
    if (
      !binds.some((bind) => Math.abs(ctEnd(bind) - stretch.tm) <= CT_EPSILON) ||
      !binds.some((bind) => Math.abs(bind.tm - ctEnd(stretch)) <= CT_EPSILON)
    )
      error(where, `the stretch at frame ${stretch.tm} does not lie between two binds`);

  /* Coverage, by Chat's rule: ranges are half-open, and a frame on an end no range
     continues belongs to the range it ends. A track key equal to the one before it rests. */
  const rangeAt = (list, frame) =>
    list.find((range) => frame >= range.tm - CT_EPSILON && frame < ctEnd(range) - CT_EPSILON) ??
    list.find((range) => Math.abs(frame - ctEnd(range)) <= CT_EPSILON);
  const ranges = [...binds, ...stretches];
  const tracks = layers.filter(({ nm }) => typeof nm === 'string' && nm.startsWith('ct-track:'));
  for (const track of tracks) {
    const position = track.ks?.p;
    if (track.ty !== 3 || track.parent !== undefined) error(where, `${track.nm} must be an unparented null`);
    if (position?.a !== 1 || !Array.isArray(position.k)) {
      error(where, `${track.nm} must have keyframed positions`);
      continue;
    }
    for (const [index, key] of position.k.entries()) {
      if (!isZeroTangent(key.to) || !isZeroTangent(key.ti)) {
        error(where, `${track.nm} keyframes must have no spatial tangents`);
        break;
      }
      const previous = position.k[index - 1];
      const rests =
        previous &&
        Math.abs(previous.s?.[0] - key.s?.[0]) < CT_EPSILON &&
        Math.abs(previous.s?.[1] - key.s?.[1]) < CT_EPSILON;
      if (!rests && !rangeAt(ranges, key.t)) {
        error(where, `${track.nm} keyframe at frame ${key.t} lies outside every ct:bind and ct:stretch range`);
        break;
      }
    }
  }

  /* Each section, read through its own path: travel binds, cycles, copy entry, hide window and poses. */
  const shownIn = (track, kind) => {
    const hidden = CT_COPY_SECTIONS.has(kind) ? 'ct-if:no-copy' : 'ct-if:copy';
    const children = layers.filter((layer) => track.ind !== undefined && layer.parent === track.ind);
    return !children.length || !children.every(({ nm }) => nm?.startsWith(hidden));
  };
  const differs = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) > CT_POSE_TOLERANCE;
  for (const kind of sections) {
    const list = splices[kind] ?? [];
    const onPath = (frame) => {
      const splice = list.find(({ cut }) => frame >= cut.tm - CT_EPSILON && frame <= ctEnd(cut) + CT_EPSILON);
      return splice ? splice.fill.tm + (frame - splice.cut.tm) : frame;
    };
    /* A fill lasts as long as its cut, so a composition frame shows the same frame or its fill. */
    const sectionTravel = layerFor(kind, 'ct-travel');
    const travelKeys = sectionTravel?.ks?.p?.a === 1 ? sectionTravel.ks.p.k : [];
    for (const key of travelKeys) {
      const range = rangeAt(binds, onPath(key.t));
      if (!range) {
        error(where, `${sectionTravel.nm} keyframe at frame ${key.t} lies outside every ct:bind range in "${kind}"`);
        break;
      }
    }
    const shown = tracks.filter((track) => shownIn(track, kind));
    for (const { cycle, window } of cycles) {
      const inTrunk = ctInside(window, trunk.from, trunk.to);
      const replaced = list.some(({ cut }) => ctInside(window, cut.tm, ctEnd(cut)));
      const inOwnFill = list.some(({ fill }) => ctInside(window, fill.tm, ctEnd(fill)));
      if (!((inTrunk && !replaced) || inOwnFill)) continue;
      const compositionFrame = (frame) => {
        const splice = list.find(({ fill }) => frame >= fill.tm - CT_EPSILON && frame <= ctEnd(fill) + CT_EPSILON);
        return splice ? splice.cut.tm + (frame - splice.fill.tm) : frame;
      };
      const travelled =
        ctValueAt(sectionTravel?.ks?.p, compositionFrame(ctEnd(window)))[0] -
        ctValueAt(sectionTravel?.ks?.p, compositionFrame(window.tm))[0];
      if (!(Math.abs(travelled) > 0)) error(where, `cycle window ${window.arg} has no authored travel in "${kind}"`);
      for (const track of shown) {
        const keys = track.ks?.p?.a === 1 ? track.ks.p.k : [];
        if (!keys.some(({ t }) => t > cycle.tm + CT_EPSILON && t < ctEnd(cycle) - CT_EPSILON)) continue;
        const at = (frame) => keys.find(({ t }) => Math.abs(t - frame) <= CT_EPSILON);
        const first = at(cycle.tm);
        const last = at(ctEnd(cycle));
        if (!first || !last) error(where, `${track.nm} has no keyframe at an edge of cycle ${cycle.arg}`);
        else if (differs(first.s, last.s)) error(where, `${track.nm} does not close cycle ${cycle.arg}`);
      }
    }
    if (CT_COPY_SECTIONS.has(kind) && entry && restore) {
      const length = trunk.to - trunk.from;
      const hideAt = entry.tm / length;
      if (!(hideAt >= SNAPSHOT_HIDE_FADE_SHARE && hideAt <= restore.tm / length))
        error(where, `ct:entry lies outside the hide window in "${kind}"`);
      if (kind.endsWith('-card')) {
        const copy = layers.find(({ nm }) => nm === 'ct-track:copy');
        const keys = copy?.ks?.p?.a === 1 ? copy.ks.p.k : [];
        if (!keys.some(({ t }) => Math.abs(t - onPath(entry.tm)) <= CT_EPSILON))
          error(where, `ct-track:copy has no keyframe at ct:entry in "${kind}"`);
      }
    }
    /* Poses at every splice edge the section plays through, in world space (track
       plus this section's travel), for each track that is visible there: the copy
       between ct:entry and ct:restore, any other track while a child shows. */
    const isVisibleAt = (track, frame) => {
      if (track.nm === 'ct-track:copy')
        return !!entry && !!restore && frame >= entry.tm - CT_EPSILON && frame <= restore.tm + CT_EPSILON;
      const children = layers.filter((layer) => track.ind !== undefined && layer.parent === track.ind);
      return (
        !children.length ||
        children.some(
          (child) =>
            frame >= (child.ip ?? 0) && frame < (child.op ?? Infinity) && ctValueAt(child.ks?.o, frame)[0] > 0,
        )
      );
    };
    for (const { cut, fill } of list)
      for (const [trunkFrame, fillFrame] of [
        [cut.tm, fill.tm],
        [ctEnd(cut), ctEnd(fill)],
      ]) {
        /* Nothing plays after a fill that runs to the end of the trunk. */
        if (trunkFrame >= trunk.to - CT_EPSILON) continue;
        const travelAt = ctValueAt(sectionTravel?.ks?.p, trunkFrame);
        const baseTravel = ctValueAt(travel.ks?.p, trunkFrame);
        for (const track of shown.filter(
          (item) => isVisibleAt(item, trunkFrame) || isVisibleAt(item, fillFrame),
        )) {
          const before = ctValueAt(track.ks?.p, trunkFrame);
          const after = ctValueAt(track.ks?.p, fillFrame);
          if (differs([before[0] + baseTravel[0], before[1] + baseTravel[1]], [after[0] + travelAt[0], after[1] + travelAt[1]]))
            error(where, `${track.nm} does not match its pose at the "${kind}" splice edge ${trunkFrame}`);
        }
      }
  }
};


/* ---------- interaction-history-ladder-v1 ---------- */
/* Mirrors Chat's history-ladder-contract and lottie-markers. The metadata is
   private host input, not artwork: reject transforms, painting and ownership
   that would make the measured placement differ from native playback. */
const HISTORY_LADDER = 'interaction-history-ladder-v1';
const checkHistoryLadder = (animation, where) => {
  const fail = (message) => { throw new TypeError(message); };
  const rows = new Set(Array.from({ length: 6 }, (_, index) => `row-${index}`));
  const only = (value, names) => isRecord(value) && Object.keys(value).every((key) => names.includes(key));
  const staticValue = (property) => {
    if (!only(property, ['a', 'k']) || property.a !== 0) fail('metadata must be static');
    return property.k;
  };
  const vector = (property, length) => {
    const value = staticValue(property);
    if (!Array.isArray(value) || value.length !== length || !value.every(isFiniteNumber))
      fail('invalid static vector');
    return value;
  };
  const identity = (layer, allowPosition = false, opacity = 100) => {
    const transform = layer.ks ?? {};
    if (!only(transform, ['p', 'a', 's', 'r', 'o'])) fail(`unsupported transform on ${layer.nm}`);
    for (const [key, expected] of [
      ['a', [0, 0, 0]], ['s', [100, 100, 100]],
      ...(!allowPosition ? [['p', [0, 0, 0]]] : []),
    ])
      if (transform[key] !== undefined && vector(transform[key], 3).some((value, index) => value !== expected[index]))
        fail(`nonidentity ${key} on ${layer.nm}`);
    if (transform.r !== undefined && staticValue(transform.r) !== 0) fail(`rotation on ${layer.nm}`);
    if (transform.o !== undefined && staticValue(transform.o) !== opacity) fail(`opacity on ${layer.nm}`);
  };
  const metadata = (layer) => {
    if (!only(layer, ['ty', 'ind', 'nm', 'ks', 'shapes', 'ip', 'op', 'st', 'sr', 'ao', 'ddd', 'hd']) ||
        (layer.st !== undefined && layer.st !== 0) ||
        (layer.sr !== undefined && layer.sr !== 1) ||
        (layer.ddd !== undefined && layer.ddd !== 0) ||
        (layer.ao !== undefined && layer.ao !== 0) ||
        (layer.hd !== undefined && typeof layer.hd !== 'boolean'))
      fail(`unsupported metadata on ${layer.nm}`);
  };
  const rectangle = (layer) => {
    metadata(layer);
    identity(layer, false, 0);
    if (layer.ty !== 4 || layer.ks?.o === undefined || !Array.isArray(layer.shapes) || layer.shapes.length !== 1)
      fail(`expected an invisible rectangle on ${layer.nm}`);
    const shape = layer.shapes[0];
    if (!only(shape, ['ty', 'nm', 'p', 's', 'r', 'd', 'hd']) || shape.ty !== 'rc' ||
        (shape.d !== undefined && shape.d !== 1 && shape.d !== 3) ||
        (shape.hd !== undefined && typeof shape.hd !== 'boolean') ||
        (shape.r !== undefined && staticValue(shape.r) !== 0))
      fail(`painted or transformed rectangle on ${layer.nm}`);
    const position = vector(shape.p, 2);
    const size = vector(shape.s, 2);
    if (size.some((value) => value <= 0 || value > 4096)) fail(`unbounded rectangle on ${layer.nm}`);
    return { position, size };
  };
  const easing = (key, last) => {
    if (Boolean(key.i) !== Boolean(key.o)) fail('easing handles must be paired');
    if (!last && key.h !== 1 && (!key.i || !key.o)) fail('nonhold keys require explicit easing');
    for (const handle of [key.o, key.i]) {
      if (!handle) continue;
      for (const control of [handle.x, handle.y]) {
        const values = Array.isArray(control) ? control : [control];
        if (!values.length || values.some((value) => !isFiniteNumber(value) || value < 0 || value > 1 || value !== values[0]))
          fail('unsupported easing');
      }
    }
  };
  const positionKeys = (layer, end) => {
    metadata(layer);
    const position = layer.ks?.p;
    if (layer.ty !== 3 || layer.shapes !== undefined ||
        !only(position, ['a', 'k']) || position.a !== 1 ||
        !Array.isArray(position.k) || position.k.length < 2 || position.k.length > 512)
      fail(`expected an unparented keyed track ${layer.nm}`);
    position.k.forEach((key, index, keys) => {
      if (!isRecord(key) || !isFiniteNumber(key.t) || key.t < 0 || key.t > end ||
          (index > 0 && key.t <= keys[index - 1].t) || !Array.isArray(key.s) ||
          key.s.length < 2 || key.s.length > 3 || !key.s.every(isFiniteNumber) ||
          'e' in key || (key.h !== undefined && key.h !== 1))
        fail(`invalid position key on ${layer.nm}`);
      if ([key.to, key.ti].some((tangent) => tangent !== undefined &&
          (!Array.isArray(tangent) || tangent.some((value) => value !== 0))))
        fail(`spatial tangents on ${layer.nm}`);
      easing(key, index === keys.length - 1);
    });
    if (position.k[0].t !== 0 || position.k.at(-1).t !== end) fail(`track ${layer.nm} must cover the timeline`);
    return position.k;
  };
  const scalar = (layer, name, positions) => {
    const property = layer.ks?.[name];
    if (property === undefined) return;
    if (!only(property, ['a', 'k'])) fail(`unsupported ${name} property`);
    const valid = (value) => isFiniteNumber(value) && (name === 'o' ? value >= 0 && value <= 100 : Math.abs(value) <= 360);
    if (property.a === 0) {
      if (!valid(property.k)) fail(`invalid ${name} on ${layer.nm}`);
      return;
    }
    if (property.a !== 1 || !Array.isArray(property.k) || property.k.length !== positions.length)
      fail(`invalid ${name} keys on ${layer.nm}`);
    property.k.forEach((key, index) => {
      if (!isRecord(key) || key.t !== positions[index].t || !Array.isArray(key.s) ||
          key.s.length !== 1 || !valid(key.s[0]) || 'e' in key || (key.h !== undefined && key.h !== 1))
        fail(`invalid ${name} key on ${layer.nm}`);
      easing(key, index === positions.length - 1);
      if (easingOf(key) !== easingOf(positions[index])) fail('copy tracks must share key times and easing');
    });
  };
  try {
    if (!isRecord(animation) || ![animation.w, animation.h, animation.fr, animation.op].every((value) => isFiniteNumber(value) && value > 0) ||
        animation.fr > 120 || animation.ip !== 0 || animation.tm !== undefined ||
        !Array.isArray(animation.layers) || animation.layers.length > 48 || !animation.layers.every(isRecord))
      fail('invalid composition');
    const { layers, op: end } = animation;
    const one = (name) => {
      const matches = layers.filter(({ nm }) => nm === name);
      if (matches.length !== 1) fail(`expected one ${name}`);
      return matches[0];
    };
    const hasFlight = layers.some(({ nm }) => nm === 'hl-track:flight');
    const trackKinds = ['actor', 'copy', ...(hasFlight ? ['flight'] : [])];
    const viewportAnchors = hasFlight ? ['viewport-start', 'viewport-end'] : [];
    const referenceNames = new Set([...rows, ...viewportAnchors]);
    const references = new Map();
    for (const row of referenceNames) {
      const layer = one(`hl-anchor:${row}`);
      metadata(layer);
      identity(layer, true);
      if (layer.ty !== 3 || layer.shapes !== undefined) fail(`invalid reference ${row}`);
      const point = vector(layer.ks?.p, 3);
      if (rows.has(row) && references.size && point[1] <= [...references.values()].at(-1)[1]) fail('references are not ordered');
      references.set(row, point);
      if (rows.has(row)) rectangle(one(`hl-bounds:${row}`));
    }
    if (hasFlight) rectangle(one('hl-flight-bounds'));
    else if (layers.some(({ nm }) => nm === 'hl-flight-bounds')) fail('flight bounds without flight');
    const lines = layers.filter(({ nm }) => nm?.startsWith('hl-if:drawn:top-line:'));
    if (lines.length) {
      const line = lines[0];
      const path = line.shapes?.[0];
      const value = path?.ks?.k;
      const strokes = line.shapes?.slice(1) ?? [];
      const transform = line.ks;
      const equal = (name, expected) => transform?.[name]?.a === 0 && JSON.stringify(transform[name]?.k) === JSON.stringify(expected);
      if (lines.length !== 1 || line.nm !== 'hl-if:drawn:top-line:row-0' || line.ty !== 4 ||
          line.parent !== layers.find(({ nm }) => nm === 'hl-follow:row-0')?.ind || line.parent === undefined ||
          !equal('p', [0, 0, 0]) || !equal('a', [0, 0, 0]) || !equal('s', [100, 100, 100]) ||
          transform?.r?.a !== 0 || transform.r.k !== 0 ||
          Object.keys(transform).some((name) => !['p', 'a', 's', 'r', 'o'].includes(name)) ||
          line.ef !== undefined || line.masksProperties !== undefined || line.ao === 1 ||
          path?.ty !== 'sh' || path.ks?.a !== 0 || !value || value.c !== false ||
          !Array.isArray(value.v) || value.v.length !== 2 ||
          value.v.some((v) => !Array.isArray(v) || v.length !== 2 || !v.every(isFiniteNumber)) ||
          value.v[0][0] !== value.v[1][0] || value.v[0][1] >= value.v[1][1] ||
          [value.i, value.o].some((t) => !Array.isArray(t) || t.length !== 2 ||
            t.some((v) => !Array.isArray(v) || v.length !== 2 || v.some((n) => n !== 0))) ||
          strokes.length < 1 || strokes.length > 2 || strokes.some((stroke) =>
            stroke.ty !== 'st' || stroke.w?.a !== 0 || !isFiniteNumber(stroke.w.k) || stroke.w.k <= 0 || stroke.w.k > 8))
        fail('invalid viewport top line');
    }
    const range = rectangle(one('hl-range'));
    if (range.position.some((value) => value !== 0) || range.size.some((value) => value > 256)) fail('invalid range limits');
    if (layers.some(({ nm }) => nm === 'hl-drawn-bounds')) rectangle(one('hl-drawn-bounds'));
    if (animation.markers !== undefined && !Array.isArray(animation.markers)) fail('markers is not a list');
    const markers = (animation.markers ?? []).filter((marker) => isRecord(marker) && typeof marker.cm === 'string' && marker.cm.startsWith('hl:'));
    const counts = new Map();
    for (const marker of markers) {
      const [, kind, row, ...rest] = marker.cm.split(':');
      const duration = marker.dr ?? 0;
      const allowed = kind === 'actor' ? new Set([...rows, ...(hasFlight ? ['viewport-end'] : [])]) :
        kind === 'flight' ? new Set(['row-5', ...viewportAnchors]) : rows;
      if (![...trackKinds, 'edge-start', 'entry', 'restore'].includes(kind) || rest.length ||
          (trackKinds.includes(kind) ? !allowed.has(row) : row !== undefined))
        fail(`unknown marker ${marker.cm}`);
      if (!isFiniteNumber(marker.tm) || !isFiniteNumber(duration) || duration < 0 || marker.tm < 0 ||
          marker.tm + duration > end || (duration === 0 && marker.tm >= end)) fail(`marker ${marker.cm} lies outside the timeline`);
      if (trackKinds.includes(kind) ? duration <= 0 : duration !== 0) fail(`invalid duration on ${marker.cm}`);
      const count = (counts.get(marker.cm) ?? 0) + 1;
      counts.set(marker.cm, count);
      if (count > (trackKinds.includes(kind) ? 64 : 1)) fail(`marker ${marker.cm} repeats`);
    }
    const instant = (name) => {
      const matches = markers.filter(({ cm }) => cm === `hl:${name}`);
      if (matches.length !== 1) fail(`expected one hl:${name}`);
      return matches[0].tm;
    };
    if (markers.some(({ cm, tm }) => cm === 'hl:edge-start' && tm !== 0)) fail('edge selection must be at frame zero');
    const entry = instant('entry');
    const restore = instant('restore');
    if (entry < end * 0.01 || restore <= entry || restore + end * 0.04 > end) fail('invalid copy lifetime');
    const bindings = {};
    for (const kind of trackKinds) {
      const windows = markers.filter(({ cm }) => cm.startsWith(`hl:${kind}:`)).sort((a, b) => a.tm - b.tm);
      if (!windows.length || windows[0].tm !== 0 || windows.at(-1).tm + windows.at(-1).dr !== end ||
          windows.some((window, index) => index > 0 && window.tm !== windows[index - 1].tm + windows[index - 1].dr))
        fail(`uncovered or overlapping ${kind} timeline`);
      bindings[kind] = windows;
    }
    const findCopy = (frame) => bindings.copy.find((window) => frame >= window.tm - 1e-6 && frame < window.tm + window.dr - 1e-6) ??
      bindings.copy.find((window) => Math.abs(frame - window.tm - window.dr) <= 1e-6);
    const copyAnchor = findCopy(entry)?.cm.split(':')[2];
    const visibleFrom = entry - end * 0.01;
    const visibleTo = restore + end * 0.04;
    if (!copyAnchor || bindings.copy.some((window) => window.tm < visibleTo && window.tm + window.dr > visibleFrom &&
        window.cm !== `hl:copy:${copyAnchor}`) || findCopy(restore)?.cm !== `hl:copy:${copyAnchor}`)
      fail('copy changes its source anchor');
    const roots = new Set();
    for (const kind of trackKinds) {
      const layer = one(`hl-track:${kind}`);
      positionKeys(layer, end);
      identity({ ...layer, ks: { ...layer.ks, p: undefined, ...(kind === 'copy' ? { r: undefined, o: undefined } : {}) } });
      roots.add(layer.ind);
    }
    for (const layer of layers.filter(({ nm }) => typeof nm === 'string' && nm.startsWith('hl-follow:'))) {
      metadata(layer);
      if (!rows.has(layer.nm.slice('hl-follow:'.length)) || one(layer.nm) !== layer || layer.ty !== 3 || layer.shapes !== undefined)
        fail('invalid follower');
      identity(layer, true);
      vector(layer.ks?.p, 3);
      roots.add(layer.ind);
    }
    const byIndex = new Map();
    for (const layer of layers) {
      if (!Number.isSafeInteger(layer.ind) || layer.ind < 0 || byIndex.has(layer.ind) ||
          ['tm', 'tt', 'td', 'tp'].some((key) => layer[key] !== undefined) ||
          (layer.st !== undefined && layer.st !== 0) || (layer.sr !== undefined && layer.sr !== 1))
        fail('invalid layer identity or time remap');
      byIndex.set(layer.ind, layer);
    }
    let hasDrawn = false;
    for (const layer of layers) {
      const name = layer.nm ?? '';
      if (typeof name !== 'string') fail('invalid layer name');
      if (name.startsWith('hl-track:') && !trackKinds.some((kind) => name === `hl-track:${kind}`)) fail('unknown position track');
      if ((['hl-anchor:', 'hl-bounds:', 'hl-track:', 'hl-follow:'].some((prefix) => name.startsWith(prefix)) ||
           ['hl-range', 'hl-drawn-bounds', 'hl-flight-bounds'].includes(name)) &&
          ((layer.ip !== undefined && layer.ip !== 0) || (layer.op !== undefined && layer.op !== end)))
        fail('metadata must span the composition');
      if (name.startsWith('hl-anchor:') && !referenceNames.has(name.slice('hl-anchor:'.length))) fail('unknown reference');
      if (name.startsWith('hl-bounds:') && !rows.has(name.slice('hl-bounds:'.length))) fail('unknown station bounds');
      if (name.startsWith('hl-if:') && !['history', 'drawn'].some((mode) => name === `hl-if:${mode}` || name.startsWith(`hl-if:${mode}:`)))
        fail('unknown native branch');
      if (name === 'hl-if:drawn' || name.startsWith('hl-if:drawn:')) hasDrawn = true;
      if (name.startsWith('hl-bounds:') || name.startsWith('hl-anchor:') || ['hl-range', 'hl-drawn-bounds', 'hl-flight-bounds'].includes(name) || roots.has(layer.ind)) continue;
      let current = layer;
      const seen = new Set();
      while (current && !roots.has(current.ind)) {
        if (seen.has(current.ind)) fail('cyclic layer parents');
        seen.add(current.ind);
        current = byIndex.get(current.parent);
      }
      if (!current) fail(`unowned layer ${name}`);
    }
    if (!hasDrawn) fail('the complete drawn branch is required');
    const copy = one('hl-track:copy');
    const copyKeys = positionKeys(copy, end);
    scalar(copy, 'r', copyKeys);
    scalar(copy, 'o', copyKeys);
    const valueAt = (name, index, fallback) => copy.ks[name]?.a === 1 ? copy.ks[name].k[index].s[0] : (copy.ks[name]?.k ?? fallback);
    copyKeys.slice(0, -1).forEach((key, index) => {
      const visible = key.h === 1 ? valueAt('o', index, 100) > 0 : valueAt('o', index, 100) > 0 || valueAt('o', index + 1, 100) > 0;
      if (visible && (key.t < visibleFrom - 1e-6 || copyKeys[index + 1].t > visibleTo + 1e-6))
        fail('copy visibility exceeds its borrowing window');
    });
    const entryIndex = copyKeys.findIndex(({ t }) => t === entry);
    const reference = references.get(copyAnchor);
    if (entryIndex < 0 || copyKeys[entryIndex].s[0] !== reference[0] || copyKeys[entryIndex].s[1] !== reference[1])
      fail('copy entry is not its reference point');
    if (valueAt('r', entryIndex, 0) !== 0 || valueAt('o', entryIndex, 100) !== 100 ||
        valueAt('o', 0, 100) !== 0 || valueAt('o', copyKeys.length - 1, 100) !== 0)
      fail('invalid copy entry or visibility');
  } catch (cause) {
    error(where, `history ladder: ${cause.message}`);
  }
};

const checkLabels = (labels, where) => {
  const ids = new Set();
  if (labels === undefined) return ids;
  if (!isRecord(labels)) {
    error(where, 'labels must be an object');
    return ids;
  }
  const locales = Object.keys(labels);
  if (locales.length > MAX_LOCALES)
    error(where, `labels has more than ${MAX_LOCALES} locales`);
  if (locales.length && !labels.en) error(where, 'labels must include en');
  for (const [locale, entries] of Object.entries(labels)) {
    if (!LOCALE.test(locale)) error(where, `labels locale ${locale} is invalid`);
    if (!isRecord(entries)) {
      error(where, `labels.${locale} must be an object`);
      continue;
    }
    for (const [id, text] of Object.entries(entries)) {
      ids.add(id);
      if (!LABEL_ID.test(id)) error(where, `label id ${id} is invalid`);
      if (typeof text !== 'string' || text.length === 0 || text.length > MAX_LABEL_LENGTH)
        error(where, `labels.${locale}.${id} must be 1..${MAX_LABEL_LENGTH} characters`);
      else if (text.replace(/\{\{phrase\}\}/g, '').includes('{{'))
        error(where, `labels.${locale}.${id} has a placeholder other than {{phrase}}`);
    }
  }
  return ids;
};

/* Asset IDs are unique across the whole index: one ID, one sha256. */
const claimedAssetIds = new Map();

const checkManifest = (entry, file) => {
  const where = rel(file);
  const read = readJson(file, MANIFEST_MAX_BYTES, MAX_DEPTH);
  if (!read) return;
  const { value: manifest, bytes } = read;
  if (bytes.length !== entry.manifest.bytes)
    error(where, `is ${bytes.length} B but the index declares ${entry.manifest.bytes} B`);
  const actualHash = sha256(bytes);
  if (actualHash !== entry.manifest.sha256)
    error(where, `sha256 is ${actualHash} but the index declares ${entry.manifest.sha256}`);
  if (!isRecord(manifest)) {
    error(where, 'is not an object');
    return;
  }
  checkExcluded(manifest, where);
  for (const key of Object.keys(manifest))
    if (!MANIFEST_KEYS.has(key)) warn(where, `unknown field ${key} is ignored by the BFF`);
  if (manifest.schemaVersion !== 1)
    error(where, `schemaVersion ${manifest.schemaVersion} is not 1`);
  for (const key of ['packId', 'version', 'eventId'])
    if (manifest[key] !== entry[key])
      error(where, `${key} ${manifest[key]} does not match the index (${entry[key]})`);
  checkCapabilities(manifest.requiredCapabilities, where, 'requiredCapabilities');
  if ((manifest.requiredCapabilities ?? []).includes(HISTORY_LADDER))
    error(where, `${HISTORY_LADDER} must be required by its scene, not the pack`);

  const directory = dirname(file);
  const assets = new Map();
  if (!Array.isArray(manifest.assets) || manifest.assets.length > MAX_ASSETS)
    error(where, `assets must list at most ${MAX_ASSETS} entries`);
  for (const [index, asset] of (manifest.assets ?? []).entries()) {
    const path = `assets[${index}]`;
    if (!isRecord(asset)) {
      error(where, `${path} is not an object`);
      continue;
    }
    const { assetId, file: assetFile, mediaType, bytes: declared, sha256: hash } = asset;
    if (typeof assetId !== 'string' || !ASSET_ID.test(assetId)) {
      error(where, `${path}.assetId ${assetId} is invalid`);
      continue;
    }
    if (assets.has(assetId)) error(where, `${path} repeats ${assetId}`);
    assets.set(assetId, asset);
    const media = MEDIA[mediaType];
    if (!media) {
      error(where, `${path}.mediaType ${mediaType} is not allowed`);
      continue;
    }
    if (!isInt(declared) || declared < 1 || declared > media.maxBytes)
      error(where, `${path}.bytes must be within 1..${media.maxBytes}`);
    if (typeof hash !== 'string' || !SHA256.test(hash)) {
      error(where, `${path}.sha256 is not lowercase hex SHA-256`);
      continue;
    }
    if (!assetId.endsWith(hash.slice(0, 16)))
      error(where, `${path}.assetId must end with the first 16 hex of its sha256`);
    const claimed = claimedAssetIds.get(assetId);
    if (claimed && claimed !== hash)
      error(where, `${path}.assetId ${assetId} is already declared with another sha256`);
    claimedAssetIds.set(assetId, hash);
    if (!isContainedPath(assetFile)) {
      error(where, `${path}.file must be a contained relative path`);
      continue;
    }
    const match = HASHED_FILE.exec(assetFile);
    if (!match || match[1] !== hash.slice(0, 16) || match[2] !== media.ext)
      error(where, `${path}.file must be named *.<sha256 prefix>.${media.ext}`);
    const assetPath = join(directory, assetFile);
    if (!existsSync(assetPath)) {
      error(where, `${path}.file ${assetFile} is missing`);
      continue;
    }
    const content = readFileSync(assetPath);
    if (content.length !== declared)
      error(rel(assetPath), `is ${content.length} B but the manifest declares ${declared} B`);
    const actual = sha256(content);
    if (actual !== hash)
      error(rel(assetPath), `sha256 is ${actual} but the manifest declares ${hash}`);
    asset.content = content;
  }

  const known = KNOWN_EVENTS[manifest.eventId];
  if (known && manifest.event !== undefined)
    error(where, `${manifest.eventId} is compiled in Chat; its pack must not carry an event block`);
  if (!known && manifest.event === undefined)
    error(where, 'an external-only event needs an event block');
  const labelIds = checkLabels(manifest.labels, where);
  if (!known && !manifest.labels?.en)
    error(where, 'an external-only event needs labels.en');

  const reference = (assetId, path, kind) => {
    const asset = assets.get(assetId);
    if (!asset) {
      error(where, `${path} → ${assetId} is not declared in assets`);
      return undefined;
    }
    if (kind === 'image' && asset.mediaType === 'application/json')
      error(where, `${path} → ${assetId} must be an image`);
    if (kind === 'animation' && asset.mediaType !== 'application/json')
      error(where, `${path} → ${assetId} must be Lottie JSON`);
    return asset;
  };

  const sceneIds = new Set();
  if (!Array.isArray(manifest.scenes) || manifest.scenes.length === 0 || manifest.scenes.length > MAX_SCENES)
    error(where, `scenes must list 1..${MAX_SCENES} scenes`);
  for (const [index, scene] of (manifest.scenes ?? []).entries()) {
    const path = `scenes[${index}]`;
    if (!isId(scene.id)) error(where, `${path}.id is invalid`);
    if (sceneIds.has(scene.id)) error(where, `${path} repeats scene ${scene.id}`);
    sceneIds.add(scene.id);
    /* A known-event scene Chat does not compile is an addition: the operator
       may add it to the click pool, so it needs its own English toast. */
    const isAddition = known && !known.has(scene.id);
    if (!LABEL_ID.test(scene.labelId ?? '')) error(where, `${path}.labelId is invalid`);
    if (isAddition && !manifest.labels?.en?.[scene.labelId])
      error(where, `${path} adds ${scene.id} to ${manifest.eventId}; its labelId ${scene.labelId} needs labels.en`);
    if (!known && !labelIds.has(scene.labelId))
      error(where, `${path}.labelId ${scene.labelId} has no label`);
    if (!RENDERERS.has(scene.renderer)) error(where, `${path}.renderer ${scene.renderer} is unknown`);
    checkCapabilities(scene.requiredCapabilities, where, `${path}.requiredCapabilities`);
    checkPlacement(scene.placement, where, `${path}.placement`);
    const isAnchored = scene.placement?.template === 'composer-anchor-v1';
    const needsOutline = (scene.requiredCapabilities ?? []).includes(
      'interaction-composer-outline-v1',
    );
    if (isAnchored && !(scene.requiredCapabilities ?? []).includes('composer-anchor-v1'))
      error(where, `${path} uses composer-anchor-v1 placement without requiring it`);
    if (needsOutline && !isAnchored)
      error(where, `${path} requires interaction-composer-outline-v1 without composer-anchor-v1 placement`);
    const needsCatBorrow = (scene.requiredCapabilities ?? []).includes(CAT_BORROW);
    if (needsCatBorrow && !isAnchored)
      error(where, `${path} requires ${CAT_BORROW} without composer-anchor-v1 placement`);
    if (needsCatBorrow && scene.direction !== 'none')
      error(where, `${path} requires ${CAT_BORROW} with direction ${scene.direction}; it needs none`);
    const needsButtonProps = (scene.requiredCapabilities ?? []).includes(BUTTON_PROPS);
    if (needsButtonProps && (!isAnchored || scene.direction !== 'none')) error(where, `${path} button props needs composer anchoring and direction none`);
    const needsCopyTrack = (scene.requiredCapabilities ?? []).includes(COPY_TRACK);
    if (needsCopyTrack && !isAnchored)
      error(where, `${path} requires ${COPY_TRACK} without composer-anchor-v1 placement`);
    if (needsCopyTrack && scene.direction !== 'none')
      error(where, `${path} requires ${COPY_TRACK} with direction ${scene.direction}; it needs none`);
    if ((scene.requiredCapabilities ?? []).filter((capability) => capability.startsWith('interaction-')).length > 1)
      error(where, `${path} requires more than one interaction adapter`);
    const needsCarry = (scene.requiredCapabilities ?? []).includes(COMPOSER_CARRY);
    const needsHistoryLadder = (scene.requiredCapabilities ?? []).includes(HISTORY_LADDER);
    if (needsHistoryLadder && (scene.placement?.template !== 'viewport-stage-v1' ||
        !(scene.requiredCapabilities ?? []).includes('viewport-stage-v1')))
      error(where, `${path} requires ${HISTORY_LADDER} without viewport-stage-v1 placement and capability`);
    if (needsHistoryLadder && scene.direction !== 'none')
      error(where, `${path} requires ${HISTORY_LADDER} with direction ${scene.direction}; it needs none`);
    if (needsCarry && !isAnchored)
      error(where, `${path} requires ${COMPOSER_CARRY} without composer-anchor-v1 placement`);
    if (needsCarry && scene.direction !== 'none')
      error(where, `${path} requires ${COMPOSER_CARRY} with direction ${scene.direction}; it needs none`);
    if (needsCarry && (scene.placement?.edge !== 'top' || scene.placement?.fallback !== 'poster'))
      error(where, `${path} composer carry needs top-edge placement with poster fallback`);
    const hasTiming = checkTiming(scene, where, path);
    if (!['none', 'mirror', 'variant'].includes(scene.direction))
      error(where, `${path}.direction ${scene.direction} is invalid`);
    reference(scene.posterAssetId, `${path}.posterAssetId`, 'image');
    const variants = scene.variants ?? [];
    if (!Array.isArray(variants) || variants.length < 1 || variants.length > MAX_VARIANTS)
      error(where, `${path}.variants must list 1..${MAX_VARIANTS} variants`);
    const checkedAssets = new Set();
    for (const [i, variant] of variants.entries()) {
      const vpath = `${path}.variants[${i}]`;
      for (const [key, value] of Object.entries(variant.when ?? {}))
        if (
          !(
            (key === 'layout' && ['mobile', 'desktop'].includes(value)) ||
            (key === 'direction' && ['ltr', 'rtl'].includes(value)) ||
            (key === 'colorScheme' && ['light', 'dark'].includes(value))
          )
        )
          error(where, `${vpath}.when.${key} is not allowed`);
      /* A variant may use its own frame, never another template. */
      let placement = scene.placement;
      if (variant.placement !== undefined) {
        checkPlacement(variant.placement, where, `${vpath}.placement`);
        if (variant.placement?.template !== scene.placement?.template)
          error(where, `${vpath}.placement.template differs from the scene's`);
        placement = variant.placement;
      }
      if (needsCarry && (placement?.edge !== 'top' || placement?.fallback !== 'poster'))
        error(where, `${vpath} composer carry needs top-edge placement with poster fallback`);
      for (const key of Object.keys(variant))
        if (!['when', 'animationAssetId', 'placement'].includes(key))
          error(where, `${vpath}.${key} is not allowed`);
      const asset = reference(variant.animationAssetId, `${vpath}.animationAssetId`, 'animation');
      if (asset?.content && hasTiming) {
        const file = rel(join(directory, asset.file));
        if (asset.animation === undefined) {
          try {
            asset.animation = JSON.parse(asset.content.toString('utf8'));
          } catch {
            asset.animation = null;
            error(file, 'is not valid JSON');
          }
        }
        const { animation } = asset;
        if (!animation) continue;
        /* Variants may share one file: its own rules run once per scene, its frame per variant. */
        if (!checkedAssets.has(asset.assetId)) {
          checkedAssets.add(asset.assetId);
          if (depth(animation) > LOTTIE_MAX_DEPTH) error(file, `JSON depth exceeds ${LOTTIE_MAX_DEPTH}`);
          checkLottie(animation, scene.timing.playbackDurationMs, file);
          if (needsButtonProps) checkButtonProps(animation, file);
          if (needsOutline && isAnchored) checkComposerOutlineSlots(animation, file);
          if (needsCatBorrow && isAnchored) checkCatBorrow(animation, file);
          if (needsCopyTrack && isAnchored) checkCopyTrack(animation, file);
          if (needsCarry && isAnchored) checkComposerCarry(animation, file);
          if (needsHistoryLadder) checkHistoryLadder(animation, file);
        }
        if (isAnchored && placement?.template === 'composer-anchor-v1')
          checkAnchorInsideStage(animation, placement, file);
      }
    }
    if (scene.direction === 'variant' && !variants.some(({ when }) => when?.direction === 'rtl'))
      error(where, `${path} declares direction variant without an rtl variant`);
  }

  if (manifest.event !== undefined) {
    const { titleLabelId, clickSceneIds, iconAssetId, decoration } = manifest.event ?? {};
    if (!labelIds.has(titleLabelId)) error(where, 'event.titleLabelId has no label');
    if (!Array.isArray(clickSceneIds) || clickSceneIds.length === 0)
      error(where, 'event.clickSceneIds must list scenes');
    for (const id of clickSceneIds ?? [])
      if (!sceneIds.has(id)) error(where, `event.clickSceneIds → ${id} is not a scene`);
    if (iconAssetId !== undefined) reference(iconAssetId, 'event.iconAssetId', 'image');
    if (decoration?.template !== 'static-trigger-v1')
      error(where, 'event.decoration.template must be static-trigger-v1');
    reference(decoration?.posterAssetId, 'event.decoration.posterAssetId', 'image');
    if (!labelIds.has(decoration?.labelId))
      error(where, 'event.decoration.labelId has no label');
  }

  for (const asset of assets.values())
    if (asset.content && asset.mediaType === 'image/svg+xml')
      checkSvg(asset.content, rel(join(directory, asset.file)));

  /* Every file in the version directory must be declared. */
  const declaredFiles = new Set([...assets.values()].map(({ file: name }) => name));
  for (const name of readdirSync(directory))
    if (name !== 'manifest.json' && !declaredFiles.has(name))
      error(rel(join(directory, name)), 'is not declared in the manifest');
};

/* ---------- Index ---------- */
const checkIndex = () => {
  const file = join(ROOT, 'index.json');
  const where = rel(file);
  const read = readJson(file, INDEX_MAX_BYTES, MAX_DEPTH);
  if (!read) return;
  const { value: index } = read;
  if (!isRecord(index)) {
    error(where, 'is not an object');
    return;
  }
  checkExcluded(index, where);
  for (const key of Object.keys(index))
    if (!['schemaVersion', 'revision', 'packs', 'defaults'].includes(key))
      warn(where, `unknown field ${key} is ignored by the BFF`);
  if (index.schemaVersion !== 1) error(where, `schemaVersion ${index.schemaVersion} is not 1`);
  if (typeof index.revision !== 'string' || !REVISION.test(index.revision))
    error(where, 'revision must be 1..64 characters of [A-Za-z0-9._-]');
  if (!Array.isArray(index.packs)) {
    error(where, 'packs must be an array');
    return;
  }

  const listed = new Map();
  const listedDirectories = new Set();
  for (const [i, entry] of index.packs.entries()) {
    const path = `packs[${i}]`;
    if (!isRecord(entry)) {
      error(where, `${path} is not an object`);
      continue;
    }
    if (!isId(entry.packId) || !isId(entry.eventId))
      error(where, `${path} packId and eventId must be kebab-case IDs`);
    if (typeof entry.version !== 'string' || !VERSION.test(entry.version))
      error(where, `${path}.version must be strict semver`);
    const key = `${entry.packId}@${entry.version}`;
    if (listed.has(key)) error(where, `${path} repeats ${key}`);
    listed.set(key, entry);
    const manifest = entry.manifest;
    if (
      !isRecord(manifest) ||
      !isContainedPath(manifest.path) ||
      !isInt(manifest.bytes) ||
      typeof manifest.sha256 !== 'string' ||
      !SHA256.test(manifest.sha256)
    ) {
      error(where, `${path}.manifest needs a contained path, bytes and sha256`);
      continue;
    }
    if (manifest.path !== `${entry.packId}/${entry.version}/manifest.json`)
      error(where, `${path}.manifest.path must be ${entry.packId}/${entry.version}/manifest.json`);
    listedDirectories.add(join(ROOT, entry.packId, entry.version));
    checkManifest(entry, join(ROOT, manifest.path));
  }

  for (const [eventId, ref] of Object.entries(index.defaults ?? {})) {
    const entry = listed.get(`${ref?.packId}@${ref?.version}`);
    if (!entry) error(where, `defaults.${eventId} names an unlisted pack`);
    else if (entry.eventId !== eventId)
      error(where, `defaults.${eventId} names a pack for ${entry.eventId}`);
  }

  /* Published directories must be listed; old versions are deleted, not orphaned. */
  for (const packId of readdirSync(ROOT)) {
    const packDirectory = join(ROOT, packId);
    if (!statSync(packDirectory).isDirectory()) {
      if (packId !== 'index.json') error(rel(packDirectory), 'is not part of a pack');
      continue;
    }
    const versions = readdirSync(packDirectory);
    /* Preserve the published 1.2–1.4 assets while adding Snow Circus. This
       exact set is the only four-version exception; retire it separately
       after the 30-day index retention window permits removal. */
    const retainedNewYearRelease = packId === 'new-year-default' &&
      versions.length === 4 &&
      ['1.2.0', '1.3.0', '1.4.0', '1.5.1'].every(version => versions.includes(version));
    if (versions.length > MAX_VERSIONS_PER_PACK && !retainedNewYearRelease)
      error(
        rel(packDirectory),
        `holds ${versions.length} versions; keep at most ${MAX_VERSIONS_PER_PACK} (see README "Retention")`,
      );
    for (const version of versions)
      if (!listedDirectories.has(join(packDirectory, version)))
        error(rel(join(packDirectory, version)), 'is not listed in index.json');
  }
};

if (!existsSync(ROOT)) {
  console.log(`No celebration packs at ${ROOT}; nothing to check.`);
  process.exit(0);
}
checkIndex();
for (const message of warnings) console.log(`warning ${message}`);
for (const message of errors) console.log(`error   ${message}`);
console.log(
  errors.length
    ? `Celebration packs: ${errors.length} error(s), ${warnings.length} warning(s).`
    : `Celebration packs are valid (${warnings.length} warning(s)).`,
);
process.exit(errors.length ? 1 : 0);
