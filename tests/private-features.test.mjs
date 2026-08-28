import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PRIVATE_FEATURE_DEFAULTS,isPrivateFeatureOwner,loadPrivateFeatures,savePrivateFeatures} from '../repo-root/js/private-features.js';

const values=new Map();
globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
const owner={email:'elfincape@gmail.com'},other={email:'user@example.com'};
assert.equal(isPrivateFeatureOwner(owner),true);
assert.equal(isPrivateFeatureOwner(other),false);
assert.deepEqual(loadPrivateFeatures(other),PRIVATE_FEATURE_DEFAULTS);
assert.equal(savePrivateFeatures(other,{haulPrices:true}),false);
assert.equal(savePrivateFeatures(owner,{haulPrices:true,imageStraightener:true}),true);
assert.equal(loadPrivateFeatures(owner).haulPrices,true);
assert.equal(loadPrivateFeatures(owner).imageStraightener,true);
assert.equal(loadPrivateFeatures(owner).ansanGimhaeBusanAnsan,false);
assert.equal(loadPrivateFeatures(owner).auditLog,false);

const hub=readFileSync(new URL('../repo-root/admin/index.html',import.meta.url),'utf8');
assert.match(hub,/isPrivateFeatureOwner\(profile\)/);
assert.match(hub,/privateFeatures\.imageStraightener \?/);
assert.match(hub,/privateFeatures\.ansanGimhaeBusanAnsan \?/);
assert.match(hub,/privateFeatures\.auditLog \?/);
assert.match(hub,/data-private-feature/);

for(const [file,flag] of [['image-straightener.html','imageStraightener'],['ansan-gimhae-busan-ansan.html','ansanGimhaeBusanAnsan'],['audit-log.html','auditLog']]){
  const source=readFileSync(new URL(`../repo-root/admin/${file}`,import.meta.url),'utf8');
  assert.match(source,new RegExp(`loadPrivateFeatures\\([^)]*\\)\\.${flag}`));
}

console.log('private feature owner toggles and defaults checks passed');
