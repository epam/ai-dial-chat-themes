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
  'application/json': { ext: 'json', maxBytes: 300 * KIB },
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
/* The player DIAL Chat pins (`lottie-web` lottie_light). */
const MAX_LOTTIE_VERSION = [5, 13, 0];

const CAPABILITIES = new Set([
  'lottie-light-svg-v1',
  'viewport-stage-v1',
  'composer-anchor-v1',
  'static-poster-v1',
  'static-trigger-v1',
]);
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
const error = (where, message) => errors.push(`${where}: ${message}`);
const warn = (where, message) => warnings.push(`${where}: ${message}`);

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
  if (keyframes > 2000) error(where, `${keyframes} keyframes exceed 2000`);
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
  } else if (!CAPABILITIES.has(placement.template))
    error(where, `${path}.template ${placement.template} is unknown`);
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
    const hasTiming = checkTiming(scene, where, path);
    if (!['none', 'mirror', 'variant'].includes(scene.direction))
      error(where, `${path}.direction ${scene.direction} is invalid`);
    reference(scene.posterAssetId, `${path}.posterAssetId`, 'image');
    const variants = scene.variants ?? [];
    if (!Array.isArray(variants) || variants.length < 1 || variants.length > MAX_VARIANTS)
      error(where, `${path}.variants must list 1..${MAX_VARIANTS} variants`);
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
      const asset = reference(variant.animationAssetId, `${vpath}.animationAssetId`, 'animation');
      if (asset?.content && hasTiming) {
        let animation;
        try {
          animation = JSON.parse(asset.content.toString('utf8'));
        } catch {
          error(rel(join(directory, asset.file)), 'is not valid JSON');
          continue;
        }
        if (depth(animation) > LOTTIE_MAX_DEPTH)
          error(rel(join(directory, asset.file)), `JSON depth exceeds ${LOTTIE_MAX_DEPTH}`);
        checkLottie(animation, scene.timing.playbackDurationMs, rel(join(directory, asset.file)));
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
