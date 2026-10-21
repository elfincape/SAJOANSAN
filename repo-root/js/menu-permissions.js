import {supabase} from './supabase.js';
import {permissionAllowed} from './portal-permissions.js';
import {normalizeCenterCode,withCenterParam,getSelectedCenter} from './center.js';
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
export const pageResources={'routes.html':'routes','route-edit.html':'routes','delivery-points.html':'delivery_points','drivers.html':'drivers','vehicles.html':'vehicles','companies.html':'companies','transfers.html':'transfers','pyeongtaek-charter-parser.html':'charter','charter-fuel-estimator.html':'delivery_points','naver-shortest-distance.html':'delivery_points','dispatch-parser.html':'dispatch_parser','excel-compare.html':'excel_compare','pallet-slips.html':'pallet_slips','one-top-two-room-work.html':'one_top','daily-temperature.html':'temperature','coupang-entry.html':'coupang','haul-dispatch-calculator.html':'haul','ansan-gimhae-busan-ansan.html':'busan','image-straightener.html':'straightener','pdf-image-converter.html':'pdf_converter','export.html':'export','import.html':'import','users.html':'users','settings.html':'settings','audit-log.html':'audit','operations.html':'history','notion-health.html':'connections'};
pageResources['pyeongtaek-dispatch.html']='charter';
pageResources['gimhae-dispatch.html']='dispatch_parser';
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
  return /등록|저장|삭제|수정|추가|신규|편집|일괄 적용|갱신|완료 처리|처리완료|재개|복원|불러와 적용/.test([control.textContent,control.title,control.getAttribute('aria-label'),control.value].join(' '));
 };
 const apply=()=>{
  for(const link of document.querySelectorAll('a[href]')){const target=new URL(link.href,location.href);if(target.origin!==location.origin)continue;const resource=resourceForPath(target.pathname);if(resource){const denied=!permissionAllowed(context,resource,'read',permissionCenterForUrl(target,center));link.hidden=denied||link.dataset.hubFiltered==='true';if(denied){link.style.display='none';link.dataset.permissionHidden='true';}else if(link.dataset.permissionHidden){link.style.removeProperty('display');delete link.dataset.permissionHidden;}}}
  const grid=document.getElementById('menu-grid');if(grid&&profile.role==='admin'&&!document.getElementById('permission-center-card')){const link=document.createElement('a');link.id='permission-center-card';link.href=withCenterParam('/portal/?view=permissions');link.className='block rounded-lg border border-zinc-700 bg-zinc-800/40 p-4';const title=document.createElement('strong');title.textContent='페이지별 권한';const text=document.createElement('p');text.className='text-xs text-zinc-400 mt-1';text.textContent='페이지·업무별 열람·수정 조건과 적용 범위';link.append(title,text);grid.prepend(link);}
  for(const control of document.querySelectorAll('button,input,select,textarea'))if(deniedControl(control)){
   if(!control.disabled)control.disabled=true;
   control.dataset.permissionBlocked='true';
  }
  if(!editable){
   if(!document.getElementById('read-only-notice')){const notice=document.createElement('p');notice.id='read-only-notice';notice.className='text-sm text-amber-300 p-3';notice.textContent='열람 전용 · 선택한 센터에서 이 업무를 수정할 권한이 없습니다.';document.querySelector('main')?.prepend(notice);}
  }
 };
 apply();const observer=new MutationObserver(apply);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled']});addEventListener('pagehide',()=>observer.disconnect(),{once:true});
 document.addEventListener?.('click',e=>{const control=e.target.closest?.('button,input[type=submit],[data-permission-action]');if(control&&deniedControl(control)){e.preventDefault();e.stopImmediatePropagation();}},true);
 if(!editable)document.addEventListener('submit',e=>{if(!e.target.closest('#filters')&&!e.target.matches('[data-read-form]')&&!scopedProfileEdit(e.target)){e.preventDefault();e.stopImmediatePropagation();}},true);
}
