export function expandResultPlan(plan,snapshot){
  if(!plan||typeof plan!=='object')return null;
  const datasets={routes:snapshot.routes,deliveryPoints:snapshot.deliveryPoints,drivers:snapshot.drivers,vehicles:snapshot.vehicles,courseRows:snapshot.courseRows};
  const source=datasets[String(plan.dataset||'')];
  if(!Array.isArray(source))return null;
  const conditions=Array.isArray(plan.conditions)?plan.conditions:[];
  let rows=source.filter(row=>conditions.every(condition=>matchesPlanCondition(row,condition)));
  const sort=Array.isArray(plan.sort)?plan.sort:[];
  rows=[...rows].sort((a,b)=>{
    for(const rule of sort){
      const field=String(rule?.field||'');
      if(!field)continue;
      const result=comparePlanValues(a?.[field],b?.[field]);
      if(result)return rule?.direction==='desc'?-result:result;
    }
    return 0;
  });
  const requested=Array.isArray(plan.select)?plan.select.map(String).filter(Boolean):[];
  const available=source[0]&&typeof source[0]==='object'?Object.keys(source[0]):[];
  const fields=[...new Set(requested.filter(field=>available.includes(field)))];
  const selected=fields.length?fields:available.filter(field=>field!=='id');
  const columns=selected.map(key=>({key,label:key,type:rows.some(row=>typeof row?.[key]==='number')?'number':'text'}));
  return{columns,rows:rows.map(row=>Object.fromEntries(selected.map(key=>[key,row?.[key]??''])))};
}

function matchesPlanCondition(row,condition){
  const field=String(condition?.field||'');
  if(!field||!Object.hasOwn(row||{},field))return false;
  const actual=row?.[field],expected=condition?.value,operator=String(condition?.operator||'eq');
  if(operator==='is_empty')return actual==null||String(actual).trim()==='';
  if(operator==='not_empty')return actual!=null&&String(actual).trim()!=='';
  if(operator==='contains')return normalizePlanText(actual).includes(normalizePlanText(expected));
  if(operator==='eq')return typeof actual==='boolean'?actual===normalizePlanBoolean(expected):normalizePlanText(actual)===normalizePlanText(expected);
  if(operator==='neq')return typeof actual==='boolean'?actual!==normalizePlanBoolean(expected):normalizePlanText(actual)!==normalizePlanText(expected);
  const a=Number(actual),b=Number(expected);
  if(!Number.isFinite(a)||!Number.isFinite(b))return false;
  return operator==='lt'?a<b:operator==='lte'?a<=b:operator==='gt'?a>b:operator==='gte'?a>=b:false;
}

function normalizePlanText(value){return String(value??'').trim().toLocaleLowerCase('ko')}
function normalizePlanBoolean(value){return value===true||['true','o','예','활성','등록'].includes(normalizePlanText(value))}
function comparePlanValues(a,b){if(typeof a==='number'&&typeof b==='number')return a-b;return String(a??'').localeCompare(String(b??''),'ko',{numeric:true})}
