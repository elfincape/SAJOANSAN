export const searchLabels={task:'업무',incident:'특이사항',survey:'업무조사',vehicles:'차량',drivers:'기사',routes:'코스',companies:'회사',delivery_points:'납품처',file:'첨부파일'};
export function searchTarget(kind,row){
 if(kind==='file')for(const type of ['task','incident','survey'])if(row[type+'_id'])return {type,id:row[type+'_id']};
 if(['task','incident','survey'].includes(kind))return {type:kind,id:row.id};
 const page={vehicles:'vehicles',drivers:'drivers',routes:'route-edit',companies:'companies',delivery_points:'delivery-points'}[kind];
 return page?{href:'/admin/'+page+'.html?'+new URLSearchParams({id:row.id,...(row.center_code?{center:row.center_code}:{})})}:null;
}
export function createPortalSearch({supabase,node,button,centerName,openRecord,message}){
 const saved={term:'',center:'',page:0};let generation=0;
 return function renderSearch(centers){
  const ticket=++generation,actions=document.getElementById('quick-actions'),items=document.getElementById('items'),detail=document.getElementById('detail');
  actions.replaceChildren();items.replaceChildren();detail.replaceChildren(node('h2','통합 검색'),node('p','완료 업무와 해결된 특이사항도 검색합니다. 차량번호로 과거 특이사항을 찾을 때는 당시 입력한 번호를 사용하세요.'));
  document.getElementById('list-title').textContent='유형별 검색 결과';document.getElementById('count').textContent='';
  const form=node('form',undefined,'portal-form'),input=node('input'),scope=node('select');
  input.type='search';input.required=true;input.minLength=2;input.maxLength=100;input.placeholder='업무명·차량번호·기사·회사·납품처';input.setAttribute('aria-label','검색어');input.value=saved.term;
  let option=node('option','모든 센터');option.value='';scope.append(option);scope.setAttribute('aria-label','검색 센터');
  for(const c of centers){option=node('option',c.name);option.value=c.code;scope.append(option);}scope.value=saved.center;
  form.append(input,scope,node('button','검색','primary'));actions.append(form);
  async function search(page=0){
   const term=input.value.trim();if(term.length<2||term.length>100){message('검색어를 2~100자로 입력하세요.',true);return;}
   Object.assign(saved,{term,center:scope.value,page});const query={p_query:term,p_center:scope.value||null,p_page:page};
   const request=++generation;form.querySelector('button').disabled=true;message('검색 중입니다…');
   try{
    const {data,error}=await supabase.rpc('operations_search',query);if(error)throw error;
    if(generation!==request||!form.isConnected)return;items.replaceChildren();
    const total=data.groups.reduce((sum,g)=>sum+g.total,0);document.getElementById('count').textContent=total+'건';
    for(const group of data.groups){items.append(node('h3',(searchLabels[group.kind]??group.kind)+' · '+group.total+'건'));
     for(const row of group.items){const line=node('div',undefined,'history-entry');line.append(node('p',row.title),node('small',[row.center_code?centerName(row.center_code):'공통',row.work_date].filter(Boolean).join(' · ')));
      const target=searchTarget(group.kind,row);if(target?.href){const link=node('a','관리 화면 열기');link.href=target.href;line.append(link);}
      else if(target)button(group.kind==='file'?'첨부된 원본 기록 열기':'원본 기록 열기',()=>openRecord(target.type,target.id),line);
      items.append(line);
     }
    }
    if(!total)items.append(node('p','검색 결과가 없습니다.'));
    const pages=node('div');if(page>0)button('이전 20건',()=>search(page-1),pages);
    if(data.groups.some(g=>g.total>(page+1)*20)&&page<100)button('유형별 다음 20건',()=>search(page+1),pages);items.append(pages);message('');
   }catch(error){if(generation===request&&form.isConnected)message(error.message||'검색하지 못했습니다.',true);}
   finally{if(form.isConnected)form.querySelector('button').disabled=false;}
  }
  form.onsubmit=event=>{event.preventDefault();search();};
  if(saved.term&&generation===ticket)search(saved.page);else items.append(node('p','검색어를 입력하세요.'));
 };
}
