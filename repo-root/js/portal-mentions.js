import {setupDialogDismiss} from './portal-dialog.js';
const labels={task:'업무',incident:'특이사항',survey:'업무조사',routes:'코스',drivers:'기사',vehicles:'차량',companies:'운수사',delivery_points:'납품처'};
const tables={task:'operations_tasks',incident:'operations_incidents',survey:'operations_surveys',routes:'routes',drivers:'drivers',vehicles:'vehicles',companies:'companies',delivery_points:'delivery_points'};
const pattern=/@\[([^\]\n]{1,200})\]\((task|incident|survey|routes|drivers|vehicles|companies|delivery_points):([0-9a-f-]{36})\)/gi;
export function setupPortalMentions({supabase,centerName}){
 let timer,generation=0,active=null,replaceRange=null,composing=false,choices=[],selectedIndex=0;const cache=new Map();const list=document.createElement('div');list.className='mention-suggestions';list.setAttribute('role','listbox');list.setAttribute('aria-label','DB 멘션 자동완성');list.hidden=true;
 const text=(tag,value,parent)=>{const el=document.createElement(tag);el.textContent=value;parent.append(el);return el;};
 async function open(kind,id,title){
  const dialog=document.createElement('dialog');dialog.className='mention-dialog';dialog.setAttribute('aria-label','멘션 정보');document.body.append(dialog);setupDialogDismiss(dialog);dialog.addEventListener('close',()=>dialog.remove(),{once:true});text('h2',title,dialog);const close=text('button','닫기',dialog);close.type='button';close.onclick=()=>dialog.close();const content=text('div','불러오는 중…',dialog);dialog.showModal();
  try{const {data,error}=await supabase.from(tables[kind]).select('*').eq('id',id).single();if(error)throw error;content.replaceChildren();if(data.center_code)text('p',centerName(data.center_code),content);show(data,content);
   if(kind==='routes'){
    const relations=[['companies',[data.company_id]],['drivers',[data.primary_driver_id,data.secondary_driver_id]],['vehicles',[data.primary_vehicle_id,data.secondary_vehicle_id]]];
    const stops=await supabase.from('route_stops').select('delivery_point_id,stop_order').eq('route_id',id).order('stop_order');if(stops.error)throw stops.error;relations.push(['delivery_points',(stops.data??[]).map(s=>s.delivery_point_id)]);
    for(const [table,ids] of relations){const keys=[...new Set(ids.filter(Boolean))];if(!keys.length)continue;const result=await supabase.from(table).select('*').in('id',keys);if(result.error){text('p',labels[table]+' 정보를 열람할 수 없습니다.',content);continue;}text('h3',labels[table],content);const map=new Map(result.data.map(r=>[r.id,r]));for(const key of keys){const row=map.get(key);if(row)show(row,content);}}
   }
  }catch(error){content.replaceChildren();text('p','정보를 불러올 수 없습니다. 삭제되었거나 열람 권한이 없을 수 있습니다.',content);}
 }
 function show(row,parent){const dl=document.createElement('dl');parent.append(dl);for(const [key,label] of Object.entries({title:'업무명',name:'이름',route_name:'코스명',code:'코드',plate_number:'차량번호',phone:'연락처',address:'주소',region:'지역',status:'상태',work_date:'시작일',work_end_date:'종료일',memo:'메모',delivery_method:'납품 방법',delivery_location:'납품 위치'}))if(row[key]!=null&&row[key]!==''){text('dt',label,dl);text('dd',String(row[key]),dl);}if(row.inputs?.work_note)text('p',row.inputs.work_note,parent);}

 const editors=new WeakMap();
 function chip(label,kind,id,inline=false){const el=document.createElement(inline?'span':'button');if(!inline)el.type='button';el.className='db-mention';el.textContent='@'+label;el.title=labels[kind]+' 정보 보기';el.dataset.kind=kind;el.dataset.id=id;el.dataset.label=label;if(inline){el.contentEditable='false';el.setAttribute('role','button');el.setAttribute('aria-disabled','false');el.tabIndex=0;}else el.onclick=e=>{e.stopPropagation();open(kind,id,label);};return el;}
 function fragments(value,inline=false){const fragment=document.createDocumentFragment();let last=0;for(const m of value.matchAll(pattern)){fragment.append(document.createTextNode(value.slice(last,m.index)),chip(m[1],m[2],m[3],inline));last=m.index+m[0].length;}fragment.append(document.createTextNode(value.slice(last)));return fragment;}
 function serialize(editor){if(!editor.textContent&&!editor.querySelector('.db-mention'))return '';function walk(parent){if(['DIV','P'].includes(parent.tagName)&&parent.childNodes.length===1&&parent.firstChild.nodeName==='BR')return '';let result='';for(const child of parent.childNodes){if(child.nodeType===3)result+=child.textContent;else if(child.nodeType===1){if(child.matches('.db-mention'))result+='@['+child.dataset.label+']('+child.dataset.kind+':'+child.dataset.id+')';else if(child.tagName==='BR')result+='\n';else{if(['DIV','P'].includes(child.tagName)&&child.previousSibling&&!result.endsWith('\n'))result+='\n';result+=walk(child);}}}return result;}return walk(editor);}
 function sync(input,editor){editor.contentEditable=String(!input.disabled&&!input.readOnly);editor.setAttribute('aria-readonly',String(input.disabled||input.readOnly));editor.setAttribute('aria-disabled',String(input.disabled));editor.classList.toggle('mention-readonly',input.disabled||input.readOnly);}
 function enhance(input){if(editors.has(input)||input.type==='password'||input.closest('.mention-suggestions'))return;const label=input.labels?.[0],caption=label?[...label.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim():input.getAttribute('aria-label')??input.name;const editor=document.createElement('div');editor.className='mention-editor';editor.setAttribute('role','textbox');editor.setAttribute('aria-label',caption||'내용');editor.setAttribute('aria-multiline',String(input.tagName==='TEXTAREA'));editor.dataset.multiline=String(input.tagName==='TEXTAREA');editor.id='mention-editor-'+crypto.randomUUID();editor.append(fragments(input.value,true));editors.set(input,editor);editor.sourceInput=input;input.classList.add('mention-source');input.tabIndex=-1;input.setAttribute('aria-hidden','true');input.after(editor);if(label===input.parentElement){const wrap=document.createElement('div');for(const attribute of label.attributes)wrap.setAttribute(attribute.name,attribute.value);wrap.classList.add('mention-field');while(label.firstChild)wrap.append(label.firstChild);label.replaceWith(wrap);}sync(input,editor);input.addEventListener('invalid',event=>{event.preventDefault();editor.focus();});editor.addEventListener('paste',event=>{event.preventDefault();document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));});editor.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing&&event.keyCode!==229&&editor.dataset.multiline==='false'){event.preventDefault();input.form?.requestSubmit();}});}
 function update(editor){const input=editor.sourceInput;input.value=serialize(editor);input.setCustomValidity(input.maxLength>0&&input.value.length>input.maxLength?'최대 '+input.maxLength+'자까지 입력할 수 있습니다.':'');input.dispatchEvent(new Event('input',{bubbles:true}));}
 function place(){
  if(!active||list.hidden)return;
  const rect=active.getBoundingClientRect(),width=Math.min(rect.width,window.innerWidth-16);
  list.style.width=Math.max(120,width)+'px';list.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-width-8))+'px';
  const height=Math.max(36,Math.min(260,rect.top-12));list.style.maxHeight=height+'px';
  list.style.top=Math.max(4,rect.top-Math.min(list.scrollHeight,height)-6)+'px';
 }
 function hide(){clearTimeout(timer);list.hidden=true;list.replaceChildren();active=null;replaceRange=null;choices=[];composing=false;++generation;}
 function select(index){
  selectedIndex=(index+choices.length)%choices.length;
  choices.forEach((button,i)=>button.setAttribute('aria-selected',String(i===selectedIndex)));
  choices[selectedIndex]?.scrollIntoView?.({block:'nearest'});
 }
 function choose(row){
  if(!active||!replaceRange)return;
  const editor=active;editor.focus();const selection=getSelection();selection.removeAllRanges();selection.addRange(replaceRange);
  const label=row.title.replace(/[\]\n]/g,'');
  const token=chip(label,row.kind,row.id,true),space=document.createTextNode(' ');
  replaceRange.deleteContents();replaceRange.insertNode(space);replaceRange.insertNode(token);
  const caret=document.createRange();caret.setStartAfter(space);caret.collapse(true);selection.removeAllRanges();selection.addRange(caret);
  hide();update(editor);
 }
 function renderRows(rows,message){
  const previous=choices[selectedIndex]?.dataset.rowId;list.replaceChildren();choices=[];
  for(const row of rows){
   const choice=text('button',(row.center_code?centerName(row.center_code)+' · ':'')+row.title+' · '+labels[row.kind],list);
   choice.type='button';choice.setAttribute('role','option');choice.dataset.rowId=row.kind+':'+row.id;
   choice.onmousedown=e=>e.preventDefault();choice.onclick=()=>choose(row);choices.push(choice);
  }
  if(!rows.length)text('small',message||'일치하는 항목이 없습니다.',list);
  selectedIndex=Math.max(0,choices.findIndex(button=>button.dataset.rowId===previous));
  choices.forEach((button,i)=>button.setAttribute('aria-selected',String(i===selectedIndex)));place();
 }
 function tokenAtCaret(editor){
  const selection=getSelection();if(!selection?.rangeCount||!selection.isCollapsed)return null;
  const caret=selection.getRangeAt(0);if(!editor.contains(caret.startContainer)||caret.startContainer.parentElement?.closest('.db-mention'))return null;
  const prefix=caret.cloneRange();prefix.selectNodeContents(editor);prefix.setEnd(caret.startContainer,caret.startOffset);
  const before=caret.startContainer.nodeType===3?caret.startContainer.textContent.slice(0,caret.startOffset):prefix.toString();
  const match=before.match(/(?:^|\s)@([^\s@\[\]]{0,100})$/);if(!match)return null;
  const range=caret.cloneRange();
  if(caret.startContainer.nodeType===3)range.setStart(caret.startContainer,caret.startOffset-match[1].length-1);
  else{
   let remaining=match[1].length+1;const walker=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT),nodes=[];
   while(walker.nextNode())if(!walker.currentNode.parentElement.closest('.db-mention'))nodes.push(walker.currentNode);
   for(let i=nodes.length-1;i>=0;i--){const length=nodes[i].textContent.length;if(remaining<=length){range.setStart(nodes[i],length-remaining);remaining=0;break;}remaining-=length;}
   if(remaining)return null;
  }
  return {query:match[1],range};
 }
 function suggest(editor){
  clearTimeout(timer);const token=tokenAtCaret(editor);
  if(!token){if(!composing)hide();return;}
  const q=token.query,key=q.toLowerCase(),ticket=++generation;
  if(active!==editor){active=editor;editor.before(list);renderRows([],'이름을 입력하세요.');}
  replaceRange=token.range;list.hidden=false;
  const cached=cache.get(key);
  if(cached&&Date.now()-cached.at<60000)renderRows(cached.rows);
  else {
   const prefix=[...cache.keys()].filter(value=>value&&key.startsWith(value)&&Date.now()-cache.get(value).at<60000).sort((a,b)=>b.length-a.length)[0];
   const matches=prefix?cache.get(prefix).rows.filter(row=>row.title.toLowerCase().includes(key)):[];
   if(matches.length)renderRows(matches);else if(!choices.length)renderRows([],q?'검색 중…':'이름을 입력하세요.');
  }
  place();if(!q)return;
  timer=setTimeout(async()=>{
   try{
    let result=await supabase.rpc('operations_mention_search',{p_query:q,p_center:null,p_page:0});
    if(result.error?.code==='PGRST202'&&q.length>=2)result=await supabase.rpc('operations_search',{p_query:q,p_center:null,p_page:0});
    if(result.error)throw result.error;
    if(generation!==ticket||active!==editor||!editor.isConnected)return;
    const rows=(result.data.groups??[]).flatMap(g=>tables[g.kind]?g.items.map(row=>({...row,kind:g.kind})):[]).sort((a,b)=>{
     const rank=row=>{const title=row.title.toLowerCase();return title===key?0:title.startsWith(key)?1:title.includes(key)?2:3;};
     return rank(a)-rank(b)||a.title.localeCompare(b.title,'ko',{numeric:true});
    }).slice(0,20);
    cache.set(key,{at:Date.now(),rows});
    if(composing&&!rows.length&&choices.length)return;
    renderRows(rows);
   }catch{if(generation===ticket&&active===editor&&!choices.length)renderRows([],'검색을 불러오지 못했습니다. 다시 입력해 주세요.');}
  },composing?120:60);
 }
 document.addEventListener('compositionstart',event=>{if(event.target.closest?.('.mention-editor'))composing=true;});
 document.addEventListener('compositionend',event=>{const editor=event.target.closest?.('.mention-editor');if(!editor)return;composing=false;update(editor);queueMicrotask(()=>{if(editor.isConnected)suggest(editor);});});
 document.addEventListener('input',event=>{const editor=event.target.closest?.('.mention-editor');if(!editor)return;update(editor);composing=event.isComposing===true;suggest(editor);});
 window.addEventListener('resize',place);document.addEventListener('scroll',place,true);
 document.addEventListener('click',event=>{const mention=event.target.closest?.('.mention-editor .db-mention');if(mention){event.preventDefault();event.stopPropagation();open(mention.dataset.kind,mention.dataset.id,mention.dataset.label);}});document.addEventListener('keydown',event=>{
 if(active&&active.contains(event.target)&&!list.hidden&&!event.isComposing&&event.keyCode!==229&&!composing&&choices.length){
  if(['ArrowDown','ArrowUp','Enter','Tab'].includes(event.key)){
   event.preventDefault();event.stopImmediatePropagation();
   if(event.key==='ArrowDown')select(selectedIndex+1);else if(event.key==='ArrowUp')select(selectedIndex-1);else choices[selectedIndex].click();return;
  }
 }
 const mention=event.target.closest?.('.mention-editor .db-mention');if(mention&&['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();open(mention.dataset.kind,mention.dataset.id,mention.dataset.label);}if(event.key==='Escape'&&!list.hidden){event.preventDefault();event.stopPropagation();hide();}},true);document.addEventListener('pointerdown',event=>{if(!list.contains(event.target)&&!active?.contains(event.target))hide();});
 const selector='textarea,input[type=text],input:not([type])';
 function scan(root){if(root.matches?.(selector))enhance(root);for(const input of root.querySelectorAll?.(selector)??[])enhance(input);if(root.closest?.('.mention-editor,.mention-suggestions,.db-mention'))return;const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode()){const n=walker.currentNode;if(!n.parentElement.closest('textarea,script,style,.mention-editor,.mention-suggestions,.db-mention,button'))nodes.push(n);}for(const n of nodes)if(n.textContent.match(pattern))n.replaceWith(fragments(n.textContent));}
 const observer=new MutationObserver(records=>{if(active&&!active.isConnected)hide();for(const record of records){if(record.type==='attributes'){const editor=editors.get(record.target);if(editor)sync(record.target,editor);}else for(const added of record.addedNodes)if(added.nodeType===1)scan(added);}});observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly']});scan(document.body);
}
