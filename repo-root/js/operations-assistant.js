import { supabase } from './supabase.js';
import { getRequiredCenter } from './center.js';
import { buildTsv, normalizeAssistantResponse } from './operations-assistant-utils.js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';

const root=document.getElementById('operations-assistant-root');
if(root)mount();
function mount(){
  const center=getRequiredCenter();let controller=null,lastFocus=null;
  root.replaceChildren();
  const launch=el('button','ops-assistant-launcher','💬');launch.type='button';launch.title='운영 질의도우미';launch.setAttribute('aria-label','운영 질의도우미 열기');launch.setAttribute('aria-expanded','false');
  const badge=el('span','ops-assistant-badge');badge.hidden=true;launch.append(badge);
  const panel=el('section','ops-assistant-panel');panel.hidden=true;panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','false');panel.setAttribute('aria-labelledby','ops-assistant-title');
  const head=el('div','ops-assistant-head');const title=el('strong','', '운영 질의도우미');title.id='ops-assistant-title';const cb=el('span','ops-assistant-center',center.name);const spacer=el('span');spacer.style.flex='1';const fresh=button('새 대화'),close=button('닫기');head.append(title,cb,spacer,fresh,close);
  const warning=el('div','ops-assistant-warning','읽기 전용 · AI 답변은 원본 데이터 확인 필요');
  const messages=el('div','ops-assistant-messages');messages.setAttribute('aria-live','polite');
  const chips=el('div','ops-assistant-chips');['5톤 차량이 진입할 수 없는 납품처','23시 이전 마감 납품처가 포함된 코스','전화번호가 누락된 기사','코스별 납품처 수'].forEach(q=>{const b=button(q,'ops-assistant-chip');b.onclick=()=>{input.value=q;input.focus()};chips.append(b)});
  const form=el('form','ops-assistant-form');const input=el('textarea');input.placeholder='현재 센터 운영 데이터를 질문하세요';input.maxLength=1000;input.setAttribute('aria-label','운영 데이터 질문');const row=el('div','ops-assistant-form-row');const status=el('span','ops-assistant-status');const stop=button('중지');stop.hidden=true;const send=button('전송');send.type='submit';send.classList.add('btn','btn-primary');row.append(status,stop,send);form.append(input,row);panel.append(head,warning,messages,chips,form);root.append(launch,panel);
  function open(){lastFocus=document.activeElement;panel.hidden=false;launch.setAttribute('aria-expanded','true');badge.hidden=true;requestAnimationFrame(()=>input.focus())}
  function shut(){if(controller)controller.abort();panel.hidden=true;launch.setAttribute('aria-expanded','false');lastFocus?.focus?.()}
  launch.onclick=()=>panel.hidden?open():shut();close.onclick=shut;fresh.onclick=()=>{messages.replaceChildren();input.value='';status.textContent='';input.focus()};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden)shut()});input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();form.requestSubmit()}});stop.onclick=()=>controller?.abort();
  form.onsubmit=async e=>{e.preventDefault();const question=input.value.trim();if(!question||controller)return;appendUser(question);input.value='';setBusy(true);controller=new AbortController();try{const {data:{session}}=await supabase.auth.getSession();if(!session)throw new Error('로그인이 필요합니다.');const response=await fetch(`${SUPABASE_URL}/functions/v1/operations-assistant`,{method:'POST',signal:controller.signal,headers:{'content-type':'application/json',apikey:SUPABASE_ANON_KEY,'authorization':`Bearer ${session.access_token}`},body:JSON.stringify({question,center:center.slug,conversation:conversation()})});const value=await response.json().catch(()=>null);if(!response.ok||value?.error)throw new Error(value?.error?.message||'조회에 실패했습니다.');appendAnswer(normalizeAssistantResponse(value));if(panel.hidden)badge.hidden=false}catch(err){if(err.name!=='AbortError')appendError(err instanceof TypeError?'질의 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.':err.message||'조회에 실패했습니다.')}finally{controller=null;setBusy(false)}};
  function setBusy(v){send.disabled=v;input.disabled=v;stop.hidden=!v;status.textContent=v?'조회 중…':''}
  function appendUser(text){const n=el('div','ops-assistant-message user',text);n.dataset.role='user';n.dataset.content=text;messages.append(n);scroll()}
  function appendError(text){const n=el('div','ops-assistant-message error',text);messages.append(n);scroll()}
  function appendAnswer(value){const card=el('article','ops-assistant-message');card.dataset.role='assistant';card.dataset.content=value.answer.slice(0,500);card.append(el('div','ops-assistant-answer',value.answer));if(value.columns.length&&value.rows.length){const wrap=el('div','ops-assistant-table-wrap'),table=el('table','ops-assistant-table'),thead=document.createElement('thead'),tr=document.createElement('tr');value.columns.forEach(c=>tr.append(el('th','',c.label)));thead.append(tr);const tbody=document.createElement('tbody');value.rows.forEach(r=>{const rr=document.createElement('tr');value.columns.forEach(c=>rr.append(el('td','',r[c.key]??'')));tbody.append(rr)});table.append(thead,tbody);wrap.append(table);card.append(wrap)}value.notices.forEach(n=>card.append(el('div','ops-assistant-notice',n)));if(value.meta.truncated)card.append(el('div','ops-assistant-notice','일부 결과만 표시됨'));const actions=el('div','ops-assistant-actions');const copy=button(value.columns.length?'표 복사':'답변 복사','ops-assistant-copy');copy.onclick=()=>copyText(value.columns.length?buildTsv(value.columns,value.rows):value.answer);actions.append(copy);card.append(actions);messages.append(card);scroll()}
  function conversation(){return [...messages.querySelectorAll('[data-role]')].slice(-8).map(n=>({role:n.dataset.role,content:n.dataset.content.slice(0,500)}))}
  async function copyText(text){try{await navigator.clipboard.writeText(text);status.textContent='복사했습니다.'}catch{const ta=el('textarea','ops-assistant-fallback');ta.value=text;document.body.append(ta);ta.select();status.textContent='자동 복사 실패 · 선택된 내용을 복사하세요.';ta.onblur=()=>ta.remove()}}
  function scroll(){messages.scrollTop=messages.scrollHeight}
}
function el(tag,cls='',text=''){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
function button(text,cls=''){const b=el('button',cls,text);b.type='button';return b}
