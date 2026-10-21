import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../repo-root/js/menu-permissions.js',import.meta.url),'utf8');
const loadModule=async path=>import('data:text/javascript;base64,'+Buffer.from(readFileSync(new URL(path,import.meta.url),'utf8')).toString('base64'));
const {permissionAllowed}=await loadModule('../repo-root/js/portal-permissions.js');
const {normalizeCenterCode}=await loadModule('../repo-root/js/center.js');
function mount(hrefs,current='/admin/?center=ansan',storedCenter){
 const links=hrefs.map(href=>({href:new URL(href,'https://sajoansan.vercel.app').href,hidden:false,dataset:{},style:{display:'',removeProperty(key){this[key]='';}}}));
 const url=new URL(current,'https://sajoansan.vercel.app');
 let observer;
 const sandbox={URL,URLSearchParams,permissionAllowed,normalizeCenterCode,getSelectedCenter:()=>storedCenter?{code:storedCenter}:null,location:{href:url.href,origin:url.origin,pathname:url.pathname,search:url.search},document:{querySelectorAll:selector=>selector==='a[href]'?links:[],getElementById:()=>null,body:{}},MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){}},addEventListener(){}};
 vm.createContext(sandbox);
 vm.runInContext(source.replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,'')+'\nglobalThis.resourceForPath=resourceForPath;',sandbox);
 return {links,sandbox,install:context=>sandbox.installMenuPermissions(context,{role:'admin'}),refresh:()=>observer()};
}
const permitted=center=>({read:true,edit:true,read_centers:[center],edit_centers:[center]});
const hub=readFileSync(new URL('../repo-root/js/admin-menu.js',import.meta.url),'utf8');
const paths=[...new Set([...hub.matchAll(/href:\s*['"]([^'"]+)['"]/g)].map(match=>match[1]))].filter(path=>path.startsWith('/admin/'));
for(const [slug,code] of [['ansan','001'],['pyeongtaek','002']]){
 const hrefs=paths.map(path=>path+'?center='+slug);
 const ui=mount(hrefs,'/admin/?center='+slug);
 const access=Object.fromEntries(paths.map(path=>[ui.sandbox.resourceForPath(path),permitted(code)]));
 ui.install({access});
 assert.ok(ui.links.every(link=>!link.hidden),'all authorized existing hub cards must remain visible for '+slug);
 assert.equal(ui.sandbox.currentPermissionCenter(),code);
 assert.equal(ui.sandbox.permissionCenterForUrl('/admin/drivers.html?center_code='+code),code);
 assert.equal(ui.sandbox.permissionCenterForUrl('/admin/drivers.html',code),code);
}
const ui=mount(['/admin/drivers.html?center=ansan','/admin/drivers.html?center=pyeongtaek','/admin/routes.html?center=ansan','/admin/drivers.html?center_code=001','/admin/drivers.html?center=unknown','/admin/drivers.html','https://elsewhere.example/admin/drivers.html?center=ansan','/portal/']);
ui.install({access:{drivers:permitted('001')}});
assert.deepEqual(ui.links.map(link=>link.hidden),[false,true,true,false,true,false,false,false]);
assert.equal(ui.links[1].style.display,'none');
ui.links[1].href='https://sajoansan.vercel.app/admin/drivers.html?center=ansan';
ui.refresh();
assert.equal(ui.links[1].hidden,false);
assert.equal(ui.links[1].style.display,'');
const denied=mount(['/admin/drivers.html?center=ansan']);
denied.install({access:{}});
assert.equal(denied.links[0].hidden,true);
console.log('PASS: existing hub menus, both center slugs, center codes, inherited center, denied/cross-center access and restored visibility');

const dispatch=mount(['/admin/pyeongtaek-dispatch.html?center=pyeongtaek','/admin/pyeongtaek-dispatch.html?center=ansan']);
assert.equal(dispatch.sandbox.resourceForPath('/admin/pyeongtaek-dispatch.html'),'charter');
dispatch.install({access:{charter:permitted('002')}});
assert.deepEqual(dispatch.links.map(link=>link.hidden),[false,true]);
console.log('PASS: provisional dispatch follows center-scoped charter permissions');

globalThis.location={origin:'https://sajoansan.vercel.app'};
const {decorateCenterLinks}=await loadModule('../repo-root/js/center.js');
const fixedLinks=[{dataset:{fixedCenter:'true'},href:'/admin/charter-fuel-estimator.html?center=pyeongtaek'},{dataset:{},href:'/admin/drivers.html'}].map(a=>Object.assign(a,{getAttribute(){return this.href;},setAttribute(key,value){this.href=value;}}));
decorateCenterLinks({querySelectorAll:()=>fixedLinks},{slug:'ansan'});
assert.equal(fixedLinks[0].href,'/admin/charter-fuel-estimator.html?center=pyeongtaek');
assert.equal(fixedLinks[1].href,'/admin/drivers.html?center=ansan');
console.log('PASS: fixed Pyeongtaek fuel link remains scoped to its DB while other center links still follow selection');

const stored=mount(['/admin/drivers.html'],'/admin/drivers.html','001');
assert.equal(stored.sandbox.currentPermissionCenter(),'001');
assert.equal(stored.sandbox.permissionCenterForUrl('/admin/drivers.html',stored.sandbox.currentPermissionCenter()),'001');
const explicit=mount([],'/admin/drivers.html?center=pyeongtaek','001');
assert.equal(explicit.sandbox.currentPermissionCenter(),'002');
console.log('PASS: stored center scopes direct URLs; explicit URL center takes precedence');
