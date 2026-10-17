export function setupPortalSidebar(){
 const sidebar=document.getElementById('portal-sidebar'),toggle=document.getElementById('sidebar-toggle'),close=document.getElementById('sidebar-close'),backdrop=document.getElementById('sidebar-backdrop'),content=document.getElementById('portal-content'),mobile=matchMedia('(max-width: 1000px)');
 let opened=false;
 function setOpen(value,restoreFocus=false){
  opened=value&&mobile.matches;document.body.classList.toggle('sidebar-open',opened);backdrop.hidden=!opened;toggle.setAttribute('aria-expanded',String(opened));
  sidebar.inert=mobile.matches&&!opened;content.inert=opened;
  if(opened){sidebar.setAttribute('role','dialog');sidebar.setAttribute('aria-modal','true');close.focus();}
  else{sidebar.removeAttribute('role');sidebar.removeAttribute('aria-modal');if(restoreFocus&&mobile.matches)toggle.focus();}
 }
 toggle.onclick=()=>setOpen(!opened);close.onclick=()=>setOpen(false,true);backdrop.onclick=()=>setOpen(false,true);
 sidebar.addEventListener('click',event=>{const item=event.target.closest('[data-view],nav a[href]');if(!item)return;const wasOpen=opened;setOpen(false,!item.matches('[data-view]'));if(wasOpen&&item.matches('[data-view]'))document.getElementById('portal-title').focus();});
 document.addEventListener('keydown',event=>{
  if(!opened)return;if(event.key==='Escape'){event.preventDefault();setOpen(false,true);return;}
  if(event.key!=='Tab')return;
  const controls=[...sidebar.querySelectorAll('a[href],button:not(:disabled),summary')].filter(el=>el.getClientRects().length),first=controls[0],last=controls.at(-1);
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
 });
 mobile.addEventListener('change',()=>setOpen(false));setOpen(false);
}
