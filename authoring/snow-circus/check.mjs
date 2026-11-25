import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(resolve(root, '../../static/celebrations/new-year-default/1.5.1/manifest.json')));
const scene = manifest.scenes.find(({id})=>id==='snow-circus');
assert.deepEqual(JSON.parse(readFileSync(resolve(root, 'scene.json'))), scene, 'source and standard-pack descriptors differ');
const inventory=[];
for(const variant of ['desktop','mobile','poster']) {
  const file=variant==='poster'?'snow-circus.poster.svg':`snow-circus.${variant}.lottie.json`;
  const bytes=readFileSync(resolve(root,file));
  const assetId=variant==='poster'?scene.posterAssetId:scene.variants.find(({when})=>when.layout===variant).animationAssetId;
  const asset=manifest.assets.find(a=>a.assetId===assetId);
  const hash=createHash('sha256').update(bytes).digest('hex');
  assert.equal(hash,asset.sha256,`${file}: source and pack differ`);
  assert(bytes.length<=(variant==='poster'?30:512)*1024);
  const stats={variant,bytes:bytes.length,sha256:hash};
  if(variant!=='poster') {
    const data=JSON.parse(bytes);let keys=0,paths=0,vertices=0;
    const visit=value=>{
      if(!value || typeof value!=='object')return;
      if(value.a===1 && Array.isArray(value.k))keys+=value.k.length;
      if(['sh','el','rc'].includes(value.ty))paths++;
      if(Array.isArray(value.v) && Array.isArray(value.i))vertices+=value.v.length;
      assert(!value.ef && !value.masksProperties && !value.tt,'effects/masks are not permitted');
      Object.values(value).forEach(visit);
    };
    visit(data);assert.equal((data.op-data.ip)/data.fr,26);assert(data.layers.length<=48);assert(keys<=2500);assert(paths<=160);assert(vertices<=1000);
    Object.assign(stats,{layers:data.layers.length,keys,paths,vertices});
  }
  inventory.push(stats);
}
console.log(JSON.stringify(inventory,null,2));
