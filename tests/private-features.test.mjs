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
for(const key of ['routes','deliveryPoints','drivers','vehicles','companies','dispatchParser','transfers','palletSlips','oneTopWork','dailyTemperature','coupangEntry','haulCalculator','exportData','importData','users']){
  assert.equal(PRIVATE_FEATURE_DEFAULTS[key],true,`${key} should be enabled by default`);
}

const hub=readFileSync(new URL('../repo-root/admin/index.html',import.meta.url),'utf8');
assert.match(hub,/isPrivateFeatureOwner\(profile\)/);
assert.match(hub,/href:'\/admin\/settings\.html'/);
assert.match(hub,/\.filter\(menu => !menu\.feature \|\| privateFeatures\[menu\.feature\]\)/);

const settings=readFileSync(new URL('../repo-root/admin/settings.html',import.meta.url),'utf8');
assert.match(settings,/isPrivateFeatureOwner\(profile\)/);
assert.match(settings,/role="switch"/);
assert.match(settings,/aria-checked=/);
assert.doesNotMatch(settings,/type="checkbox"/);
assert.match(settings,/전체 켜기/);
assert.match(settings,/전체 끄기/);
for(const key of Object.keys(PRIVATE_FEATURE_DEFAULTS))assert.match(settings,new RegExp(`['"]${key}['"]`));

for(const [file,flag] of [['image-straightener.html','imageStraightener'],['ansan-gimhae-busan-ansan.html','ansanGimhaeBusanAnsan'],['audit-log.html','auditLog']]){
  const source=readFileSync(new URL(`../repo-root/admin/${file}`,import.meta.url),'utf8');
  assert.match(source,new RegExp(`loadPrivateFeatures\\([^)]*\\)\\.${flag}`));
}

console.log('private feature owner toggles and defaults checks passed');
