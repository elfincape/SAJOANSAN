const $=id=>document.getElementById(id);
let rooms=[],offset=0,selection=new Map(),polling=false,busy=false,challengeVersion=0,authenticated=false,resultVersion;
async function api(path,body){const r=await parent.talkcloudRequest(path,body);const data=await r.json();if(!r.ok)throw Error(data.error||'요청 실패');return data;}
let challengeUrl='';
async function showChallenge(version){const response=await parent.talkcloudRequest('challenge?v='+version);if(!response.ok)throw Error('QR 화면을 불러오지 못했습니다.');const blob=await response.blob();if(challengeUrl)URL.revokeObjectURL(challengeUrl);challengeUrl=URL.createObjectURL(blob);$('challenge-screen').src=challengeUrl;}

function say(s){if($('status').textContent!==s)$('status').textContent=s;notifyFrame();}
function dates(){return {mode:$('mode').value,from:$('from').value,to:$('to').value};}
let lastFrameState='';
function notifyFrame(){const height=Math.ceil(document.querySelector('main').getBoundingClientRect().height);const state=JSON.stringify({type:'talkcloud-state',busy,height,message:$('status').textContent,authenticated,resultVersion});if(state!==lastFrameState){lastFrameState=state;parent.postMessage(JSON.parse(state),location.origin);}}
function changed(){notifyFrame();$('delete').disabled=busy||!selection.size||[...selection.values()].some(r=>!r.to||(r.mode==='range'&&!r.from));const text=selection.size+'개 방 선택';if($('summary').textContent!==text)$('summary').textContent=text;}
function render(){
  const body=$('rooms');
  const existing=new Map([...body.rows].map(row=>[row.dataset.id,row]));
  for(const r of rooms){
    let row=existing.get(r.id);
    if(!row){
      row=document.createElement('tr');row.dataset.id=r.id;
      for(let i=0;i<4;i++)row.append(document.createElement('td'));
      const check=document.createElement('input');check.type='checkbox';
      check.onchange=()=>{check.checked?selection.set(r.id,{id:r.id,name:r.name,...dates()}):selection.delete(r.id);changed();render();};
      row.cells[0].append(check);body.append(row);
    }
    existing.delete(r.id);
    const check=row.cells[0].firstElementChild;
    check.disabled=busy;check.checked=selection.has(r.id);check.setAttribute('aria-label',r.name+' 선택');
    const setting=selection.get(r.id);
    const period=setting?.to?`${setting.mode==='range'?setting.from+' ~ ':setting.mode==='before'?'미만: ':setting.mode==='through'?'까지: ':'하루: '}${setting.to}`:'—';
    [r.name,r.size||'조회 중',period].forEach((text,i)=>{if(row.cells[i+1].textContent!==text)row.cells[i+1].textContent=text;});
  }
  for(const row of existing.values())row.remove();
  $('prev').disabled=offset===0||busy;$('next').disabled=rooms.length<20||busy;
}
async function run(action){try{await action();}catch(e){say(e.message);}}
async function monitor(){if(polling)return;polling=true;try{while(true){const s=await api('state');busy=s.busy;authenticated=s.authenticated;resultVersion=s.result_version||0;say(s.message);$('verification').hidden=!s.challenge;if(s.challenge&&challengeVersion!==s.challenge.version){challengeVersion=s.challenge.version;await showChallenge(challengeVersion);}if(!s.challenge)challengeVersion=0;$('logout').hidden=false;$('cancel').hidden=!s.busy;$('login').hidden=s.phase!=='idle';$('workspace').hidden=!s.authenticated;for(const id of ['refresh','mode','from','to'])$(id).disabled=s.busy;if(s.rooms){rooms=s.rooms;render();}changed();if(s.phase==='failed'){const message=s.message;await api('logout',{});$('login').hidden=false;$('logout').hidden=true;say(message);break;}if(s.phase==='closed')break;await new Promise(r=>setTimeout(r,1500));}}catch(e){busy=false;authenticated=false;rooms=[];selection.clear();render();$('verification').hidden=true;if(challengeUrl){URL.revokeObjectURL(challengeUrl);challengeUrl='';}$('challenge-screen').removeAttribute('src');say(e.message);$('login').hidden=false;$('workspace').hidden=true;$('logout').hidden=true;}finally{polling=false;}}
function applyDates(){for(const [id,r] of selection)selection.set(id,{...r,...dates()});changed();render();}
$('from').onchange=applyDates;$('to').onchange=applyDates;
$('mode').onchange=()=>{$('from-label').hidden=$('mode').value!=='range';applyDates();};
async function load(){await api('rooms',{offset});}
$('refresh').onclick=()=>run(load);$('prev').onclick=()=>run(async()=>{offset=Math.max(0,offset-20);await load();});$('next').onclick=()=>run(async()=>{offset+=20;await load();});
$('delete').onclick=()=>run(async()=>{busy=true;changed();await api('delete',{rooms:[...selection.values()]});});
$('cancel').onclick=()=>run(()=>api('cancel',{}));$('logout').onclick=()=>run(async()=>{await api('logout',{});location.reload();});
run(async()=>{try{await api('state');monitor();}catch(e){say(e.message);const s=await api('availability');$('login').hidden=!s.available;$('qr-login').disabled=!s.available;}});

setInterval(async()=>{if(polling)return;try{const s=await api('availability');if(polling)return;$('qr-login').disabled=!s.available;if(!s.available){$('login').hidden=true;say('다른 사용자가 작업 중입니다.');}else{$('login').hidden=false;}}catch{}},5000);


$('challenge-refresh').onclick=()=>run(()=>api('verification',{kind:'refresh'}));

$('qr-login').onclick=()=>run(async()=>{await api('login',{method:'qr'});monitor();});

if (parent === window) location.replace('/admin/talkcloud.html');
new ResizeObserver(notifyFrame).observe(document.querySelector('main'));
function syncTheme(){const style=parent.getComputedStyle(parent.document.documentElement);for(const name of ['--theme-text','--theme-muted','--theme-panel','--theme-border','--theme-border-soft','--ean-control-radius'])document.documentElement.style.setProperty(name,style.getPropertyValue(name));document.documentElement.style.colorScheme=style.colorScheme;}
syncTheme();
new MutationObserver(syncTheme).observe(parent.document.documentElement,{attributes:true,attributeFilter:['class','data-theme','style']});

let lastActivity=0,trailingActivity;
function activity(){if(!authenticated||busy)return;if(Date.now()-lastActivity<15000){if(!trailingActivity)trailingActivity=setTimeout(()=>{trailingActivity=undefined;activity();},15000);return;}lastActivity=Date.now();void api('activity',{}).catch(()=>{});}
for(const type of ['pointerdown','keydown','wheel'])addEventListener(type,activity,{passive:true});
