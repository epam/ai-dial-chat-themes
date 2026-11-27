/* Package the maintained native source in a temporary catalog for validation. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const checker = resolve(here, '../../tests/check-celebration-packs.mjs');
const source = JSON.parse(readFileSync(join(here, 'scene.json'), 'utf8'));
const root = mkdtempSync(join(tmpdir(), 'santa-history-authoring-'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const packId = 'santa-history-authoring';
const version = '0.0.0';
const eventId = 'new-year';
const directory = join(root, packId, version);
const ids = new Map();

try {
  mkdirSync(directory, { recursive: true });
  const assets = Object.entries(source.assets).map(([id, filename]) => {
    const file = join(here, filename);
    const bytes = readFileSync(file);
    const sha256 = hash(bytes);
    const extension = extname(filename);
    const assetId = `${id}-${sha256.slice(0, 16)}`;
    const publishedFile = `${id}.${sha256.slice(0, 16)}${extension}`;
    ids.set(id, assetId);
    copyFileSync(file, join(directory, publishedFile));
    return { assetId, file: publishedFile, mediaType: extension === '.svg' ? 'image/svg+xml' : 'application/json', bytes: bytes.length, sha256 };
  });
  const scene = structuredClone(source.scene);
  scene.posterAssetId = ids.get(scene.posterAssetId);
  for (const variant of scene.variants) variant.animationAssetId = ids.get(variant.animationAssetId);
  const manifest = {
    schemaVersion: 1, packId, version, eventId,
    requiredCapabilities: ['lottie-light-svg-v1', 'viewport-stage-v1', 'static-poster-v1'],
    assets, labels: source.labels, scenes: [scene],
  };
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(directory, 'manifest.json'), bytes);
  const index = {
    schemaVersion: 1, revision: `authoring-${hash(bytes).slice(0, 16)}`,
    packs: [{ packId, version, eventId, manifest: { path: `${packId}/${version}/manifest.json`, bytes: bytes.length, sha256: hash(bytes) } }],
    defaults: { [eventId]: { packId, version } },
  };
  writeFileSync(join(root, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  execFileSync(process.execPath, [checker, root], { stdio: 'inherit' });
} finally {
  rmSync(root, { recursive: true, force: true });
}
