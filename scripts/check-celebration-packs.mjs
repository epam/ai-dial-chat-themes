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
/* The player DIAL Chat pins (`lottie-web` lottie_light). */
const MAX_LOTTIE_VERSION = [5, 13, 0];

const CAPABILITIES = new Set([
  'lottie-light-svg-v1',
  'viewport-stage-v1',
  'composer-anchor-v1',
  'interaction-composer-outline-v1',
  'interaction-cat-borrow-v1',
  'interaction-composer-carry-v1',
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
  if (layers > 30) error(where, `${layers} layers exceed 30`);
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
    if (needsCatBorrow && needsOutline)
      error(where, `${path} requires both interaction adapters`);
    const needsCarry = (scene.requiredCapabilities ?? []).includes(COMPOSER_CARRY);
    if (needsCarry && !isAnchored)
      error(where, `${path} requires ${COMPOSER_CARRY} without composer-anchor-v1 placement`);
    if (needsCarry && scene.direction !== 'none')
      error(where, `${path} requires ${COMPOSER_CARRY} with direction ${scene.direction}; it needs none`);
    if (needsCarry && (needsCatBorrow || needsOutline))
      error(where, `${path} requires more than one interaction adapter`);
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
          if (needsOutline && isAnchored) checkComposerOutlineSlots(animation, file);
          if (needsCatBorrow && isAnchored) checkCatBorrow(animation, file);
          if (needsCarry && isAnchored) checkComposerCarry(animation, file);
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
    if (versions.length > MAX_VERSIONS_PER_PACK)
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
