import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PRIVATE_FEATURE_DEFAULTS,isPrivateFeatureOwner,loadPrivateFeatures,savePrivateFeatures} from '../repo-root/js/private-features.js';
import {getAdminMenus} from '../repo-root/js/admin-menu.js';

const values=new Map();
globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
const owner={email:'elfincape@gmail.com',role:'admin'},other={email:'user@example.com',role:'editor'};
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
assert.match(hub,/getAdminMenus\(profile, center.code\)/);
assert.equal(getAdminMenus(owner).some(menu=>menu.href==='/admin/settings.html'),true);
assert.equal(getAdminMenus(other).some(menu=>menu.href==='/admin/settings.html'),false);
savePrivateFeatures(owner,{routes:false});
assert.equal(getAdminMenus(owner).some(menu=>menu.feature==='routes'),false);
assert.equal(getAdminMenus(other).some(menu=>menu.feature==='routes'),true);

const settings=readFileSync(new URL('../repo-root/admin/settings.html',import.meta.url),'utf8');
const controller=readFileSync(new URL('../repo-root/js/admin-settings.js',import.meta.url),'utf8');
assert.match(controller,/CONFIGURABLE_FEATURES/);
assert.match(controller,/isPrivateFeatureOwner\(profile\)/);
assert.match(controller,/aria-checked/);
assert.match(settings,/검색 결과 켜기/);
assert.match(settings,/기본값 복원/);
const {CONFIGURABLE_FEATURES,FEATURE_CATALOG,PAGE_RESOURCES}=await import('../repo-root/js/feature-catalog.mjs');
assert.deepEqual(Object.keys(PRIVATE_FEATURE_DEFAULTS),CONFIGURABLE_FEATURES.map(feature=>feature.id));
for(const page of ['pyeongtaek-dispatch.html','gimhae-dispatch.html','pdf-image-converter.html','naver-shortest-distance.html','notion-health.html'])assert(CONFIGURABLE_FEATURES.some(f=>f.href?.endsWith(page)),page);
assert.equal(PAGE_RESOURCES['pyeongtaek-dispatch.html'],'charter');
assert.equal(PAGE_RESOURCES['route-edit.html'],'routes');
assert.equal(new Set(FEATURE_CATALOG.map(f=>f.id)).size,FEATURE_CATALOG.length);
values.set('sajo.privateFeatures.v1',JSON.stringify({drivers:false,dispatchParser:false,haulPrices:true}));
assert.equal(loadPrivateFeatures(owner).pdfConverter,false);
assert.equal(loadPrivateFeatures(owner).gimhaeDispatch,false);
assert.equal(loadPrivateFeatures(owner).pyeongtaekDispatch,true);
savePrivateFeatures(owner,{...loadPrivateFeatures(owner),gimhaeDispatch:true});
assert.equal(loadPrivateFeatures(owner).gimhaeDispatch,true);
assert.equal(loadPrivateFeatures(owner).dispatchParser,false);
assert(!getAdminMenus(owner,'001').some(f=>f.id==='pyeongtaekDispatch'));
assert(getAdminMenus(owner,'002').some(f=>f.id==='pyeongtaekDispatch'));
savePrivateFeatures(owner,Object.fromEntries(CONFIGURABLE_FEATURES.map(f=>[f.id,false])));
assert(getAdminMenus(owner,'002').some(f=>f.id==='settings'));
assert(getAdminMenus(owner,'002').some(f=>f.id==='permissions'));
values.set('sajo.privateFeatures.v1',JSON.stringify({routes:'false',drivers:null}));
assert.equal(loadPrivateFeatures(owner).routes,true);
values.set('sajo.privateFeatures.v1','corrupt');assert.deepEqual(loadPrivateFeatures(owner),PRIVATE_FEATURE_DEFAULTS);
for(const [file,flag] of [['image-straightener.html','imageStraightener'],['ansan-gimhae-busan-ansan.html','ansanGimhaeBusanAnsan'],['audit-log.html','auditLog']]){
  const source=readFileSync(new URL(`../repo-root/admin/${file}`,import.meta.url),'utf8');
  assert.match(source,new RegExp(`loadPrivateFeatures\\([^)]*\\)\\.${flag}`));
}

console.log('private feature owner toggles and defaults checks passed');

const normalSave=localStorage.setItem;
localStorage.setItem=()=>{throw new Error('storage disabled');};
assert.equal(savePrivateFeatures(owner,{routes:false}),false);
localStorage.setItem=normalSave;
console.log('storage failures report failure instead of a false saved state');
