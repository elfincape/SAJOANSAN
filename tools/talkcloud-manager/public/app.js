const $=id=>document.getElementById(id);
let rooms=[],offset=0,selection=new Map(),polling=false,busy=false,challengeVersion=0;
async function api(path,body){const r=await fetch('/api/talkcloud/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error||'요청 실패');return data;}
function say(s){$('status').textContent=s;}
function dates(){return {mode:$('mode').value,from:$('from').value,to:$('to').value};}
function changed(){parent.postMessage({type:'talkcloud-state',busy,height:document.documentElement.scrollHeight},location.origin);$('delete').disabled=busy||!selection.size||[...selection.values()].some(r=>!r.to||(r.mode==='range'&&!r.from));$('summary').textContent=selection.size+'개 방 선택';}
function render(){const fragment=document.createDocumentFragment();for(const r of rooms){const tr=document.createElement('tr');const cell=document.createElement('td');const check=document.createElement('input');check.type='checkbox';check.disabled=busy;check.checked=selection.has(r.id);check.setAttribute('aria-label',r.name+' 선택');check.onchange=()=>{check.checked?selection.set(r.id,{id:r.id,name:r.name,...dates()}):selection.delete(r.id);changed();render();};cell.append(check);tr.append(cell);for(const value of [r.name,r.size||'조회 중']){const td=document.createElement('td');td.textContent=value;tr.append(td);}const td=document.createElement('td');const setting=selection.get(r.id);td.textContent=setting?.to?`${setting.mode==='range'?setting.from+' ~ ':setting.mode==='before'?'미만: ':setting.mode==='through'?'까지: ':'하루: '}${setting.to}`:'날짜 미설정';tr.append(td);fragment.append(tr);}$('rooms').replaceChildren(fragment);$('prev').disabled=offset===0||busy;$('next').disabled=rooms.length<20||busy;}
async function run(action){try{await action();}catch(e){say(e.message);}}
async function monitor(){if(polling)return;polling=true;try{while(true){const s=await api('state');busy=s.busy;say(s.message);$('verification').hidden=!s.challenge;if(s.challenge&&challengeVersion!==s.challenge.version){challengeVersion=s.challenge.version;$('challenge-screen').src='/api/talkcloud/challenge?v='+challengeVersion;}if(!s.challenge)challengeVersion=0;$('logout').hidden=false;$('cancel').hidden=!s.busy;$('login').hidden=s.phase!=='idle';$('workspace').hidden=!s.authenticated;for(const id of ['refresh','apply','all','none','trash-info','empty-trash','mode','from','to'])$(id).disabled=s.busy;if(s.rooms){rooms=s.rooms;render();}changed();if(s.trash)$('trash-size').textContent=s.trash;if(s.phase==='failed'){const message=s.message;await api('logout',{});$('login').hidden=false;$('logout').hidden=true;say(message);break;}if(s.phase==='closed')break;await new Promise(r=>setTimeout(r,1500));}}catch(e){say(e.message);$('login').hidden=false;$('workspace').hidden=true;$('logout').hidden=true;}finally{polling=false;}}
function applyDates(){for(const [id,r] of selection)selection.set(id,{...r,...dates()});changed();render();}
$('from').onchange=applyDates;$('to').onchange=applyDates;
$('mode').onchange=()=>{$('from-label').hidden=$('mode').value!=='range';applyDates();};
$('apply').onclick=()=>{for(const [id,r] of selection)selection.set(id,{...r,...dates()});changed();render();};
$('all').onclick=()=>{for(const r of rooms)selection.set(r.id,{id:r.id,name:r.name,...dates()});changed();render();};$('none').onclick=()=>{selection.clear();changed();render();};
async function load(){await api('rooms',{offset});}
$('refresh').onclick=()=>run(load);$('prev').onclick=()=>run(async()=>{offset=Math.max(0,offset-20);await load();});$('next').onclick=()=>run(async()=>{offset+=20;await load();});
$('delete').onclick=()=>run(async()=>{busy=true;changed();await api('delete',{rooms:[...selection.values()]});});
$('cancel').onclick=()=>run(()=>api('cancel',{}));$('logout').onclick=()=>run(async()=>{await api('logout',{});location.reload();});
$('trash-info').onclick=()=>run(()=>api('trash',{}));$('empty-trash').onclick=()=>{$('confirm').showModal();};$('confirm').onclose=()=>{if($('confirm').returnValue==='yes')run(()=>api('empty-trash',{confirm:true}));};
run(async()=>{await api('state');monitor();});

setInterval(async()=>{if(polling)return;try{const s=await api('availability');$('qr-login').disabled=!s.available;if(!s.available)say('다른 사용자가 작업 중입니다. 연결 가능 여부를 자동 확인합니다.');}catch{}},5000);


$('challenge-refresh').onclick=()=>run(()=>api('verification',{kind:'refresh'}));

$('qr-login').onclick=()=>run(async()=>{await api('login',{method:'qr'});monitor();});

if (parent === window) location.replace('/admin/talkcloud.html');
new ResizeObserver(()=>parent.postMessage({type:'talkcloud-state',busy,height:document.body.scrollHeight},location.origin)).observe(document.body);
function syncTheme(){const style=parent.getComputedStyle(parent.document.documentElement);for(const name of ['--theme-text','--theme-muted','--theme-panel','--theme-border','--theme-border-soft','--ean-control-radius'])document.documentElement.style.setProperty(name,style.getPropertyValue(name));document.documentElement.style.colorScheme=style.colorScheme;}
syncTheme();
new MutationObserver(syncTheme).observe(parent.document.documentElement,{attributes:true,attributeFilter:['class','data-theme','style']});
