import {PAGE_RESOURCES} from './feature-catalog.mjs';
import {supabase} from './supabase.js';
import {permissionAllowed} from './portal-permissions.js';
import {normalizeCenterCode,getSelectedCenter} from './center.js';
let cached,pending;
export async function menuPermissions(refresh=false){
 if(refresh){cached=null;pending=null;}
 if(cached)return cached;
 if(!pending){
  const request=supabase.rpc('operations_permissions_context').then(({data,error})=>{
   if(error)throw error;
   if(pending===request)cached=data;
   return data;
  }).finally(()=>{if(pending===request)pending=null;});
  pending=request;
 }
 return pending;
}
export const pageResources=PAGE_RESOURCES;
export const resourceForPath=path=>path.startsWith('/admin/')?pageResources[path.split('/').at(-1)]:null;
export function permissionCenterForUrl(url,fallback){
 const params=new URL(url,location.href).searchParams;
 const value=params.get('center')??params.get('center_code')??fallback;
 return value==null?undefined:normalizeCenterCode(value)||value;
}
export function currentPermissionCenter(){return permissionCenterForUrl(location.href,getSelectedCenter()?.code);}
export function installMenuPermissions(context,profile){
 const key=resourceForPath(location.pathname),center=currentPermissionCenter(),editable=!key||permissionAllowed(context,key,'edit',center);
 const scopedProfileEdit=control=>location.pathname==='/admin/pyeongtaek-dispatch.html'&&center==='002'&&control.closest('#pd-profiles-panel,#relations-panel')&&permissionAllowed(context,'delivery_points','edit','002');
 const deniedControl=control=>{
  const explicit=control.closest?.('[data-permission-action]');
  if(explicit){
   if(explicit!==control&&control.matches?.('button:not([type=submit]),button[type=button]'))return false;
   return !permissionAllowed(context,explicit.dataset.permissionResource||key,explicit.dataset.permissionAction,explicit.dataset.permissionCenter||center);
  }
  if(editable||scopedProfileEdit(control)||control.closest('#filters,#app-header,#app-account-menu'))return false;
  return /등록|저장|삭제|수정|추가|신규|일괄 적용|갱신|완료 처리|처리완료|재개|복원|불러와 적용/.test([control.textContent,control.title,control.getAttribute('aria-label'),control.value].join(' '));
 };
 const apply=()=>{
  for(const link of document.querySelectorAll('a[href]')){const target=new URL(link.href,location.href);if(target.origin!==location.origin)continue;const resource=resourceForPath(target.pathname);if(resource){const denied=!permissionAllowed(context,resource,'read',permissionCenterForUrl(target,center));link.hidden=denied||link.dataset.hubFiltered==='true';if(denied){link.style.display='none';link.dataset.permissionHidden='true';}else if(link.dataset.permissionHidden){link.style.removeProperty('display');delete link.dataset.permissionHidden;}}}
  for(const control of document.querySelectorAll('button,input,select,textarea'))if(deniedControl(control)){
   if(!control.disabled)control.disabled=true;
   control.dataset.permissionBlocked='true';
  }
  if(!editable){
   if(!document.getElementById('read-only-notice')){const notice=document.createElement('p');notice.id='read-only-notice';notice.className='text-sm text-amber-300 p-3';notice.textContent='열람 전용 · 선택한 센터에서 이 업무를 수정할 권한이 없습니다.';document.querySelector('main')?.prepend(notice);}
  }
 };
 apply();const observer=new MutationObserver(apply);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});addEventListener('pagehide',event=>{if(!event.persisted)observer.disconnect();});
 document.addEventListener?.('click',e=>{const control=e.target.closest?.('button,input[type=submit],[data-permission-action]');if(control&&deniedControl(control)){e.preventDefault();e.stopImmediatePropagation();}},true);
 if(!editable)document.addEventListener('submit',e=>{if(!e.target.closest('#filters')&&!e.target.matches('[data-read-form]')&&!scopedProfileEdit(e.target)){e.preventDefault();e.stopImmediatePropagation();}},true);
}
