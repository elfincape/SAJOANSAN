export function upgradeCaptureContract(definition) {
 if(typeof definition!=='string')throw Error('Naver browser initial setup is required before deployment');
 const oldRow="(c->>'sourceRow')::int<2",newRow="(c->>'sourceRow')::int<1";
 if(definition.includes(oldRow))definition=definition.replace(oldRow,newRow);
 else if(!definition.includes(newRow))throw Error('Unexpected source-row validation; manual review required');
 const oldCount="if jsonb_array_length(c->'stops') not between 4 and 7 then raise exception '센터 포함 경유지는 2~5곳입니다.';end if;";
 const newCount="if jsonb_array_length(c->'stops') not between 3 and 7 then raise exception '실제 경유지는 최대 5곳입니다.';end if;";
 const oldEnd="if c->'stops'->>0 is distinct from c->'stops'->>(jsonb_array_length(c->'stops')-1) then raise exception '같은 차고지로 복귀해야 합니다.';end if;";
 const newEnd=`if c ? 'rotation' then
   if jsonb_typeof(c->'rotation') is distinct from 'number' or c->>'rotation' not in ('1','2') or jsonb_typeof(c->'garage') is distinct from 'string' or jsonb_typeof(c->'center') is distinct from 'string' or jsonb_typeof(c->'groupName') is distinct from 'string' or length(trim(c->>'garage')) not between 1 and 300 or length(trim(c->>'center')) not between 1 and 300 or length(trim(c->>'groupName')) not between 1 and 100 then raise exception '회차와 차고지·센터를 확인해 주세요.';end if;
   if c->>'rotation'='1' then
    if jsonb_array_length(c->'stops')<4 or c->'stops'->>0 is distinct from c->>'garage' or c->'stops'->>1 is distinct from c->>'center' or c->'stops'->>(jsonb_array_length(c->'stops')-1) is distinct from c->>'center' then raise exception '1회전은 차고지에서 출발해 센터로 복귀해야 합니다.';end if;
   else
    if c->'stops'->>0 is distinct from c->>'center' or c->'stops'->>(jsonb_array_length(c->'stops')-1) is distinct from c->>'garage' then raise exception '2회전은 센터에서 출발해 차고지로 복귀해야 합니다.';end if;
   end if;
  else
   if jsonb_array_length(c->'stops')<4 or c->'stops'->>0 is distinct from c->'stops'->>(jsonb_array_length(c->'stops')-1) then raise exception '일반 코스는 같은 차고지로 복귀해야 합니다.';end if;
  end if;`;
 if(definition.includes(oldCount)&&definition.includes(oldEnd)) {
  if(definition.split(oldCount).length!==2||definition.split(oldEnd).length!==2)throw Error('Unexpected capture rules; manual review required');
  definition=definition.replace(oldCount,newCount).replace(oldEnd,newEnd);
 }
 if(!definition.includes(newCount)||!definition.includes("if c ? 'rotation' then"))throw Error('Unexpected rotation validation; manual review required');
 const oldSaved="where e.value->>'imagePath' is not null",previousSaved=oldSaved+" or (e.value->'optimization'->>'version'='1' and e.value->'optimization'->>'policy'='naver-all-driving-options-v1')",newSaved=oldSaved+" or (e.value->'optimization'->>'version'='1' and e.value->'optimization'->>'policy' in ('naver-all-driving-options-v1','naver-all-driving-options-meters-v2'))";
 const oldPending="where not(saved ? (value->>'id'))",newPending="where saved->(value->>'id')->>'imagePath' is null";
 if(definition.includes(previousSaved))definition=definition.replace(previousSaved,newSaved);
 else if(!definition.includes(newSaved)){
  if(!definition.includes(oldSaved)||!definition.includes(oldPending))throw Error('Unexpected retry rules; manual review required');
  definition=definition.replace(oldSaved,newSaved).replace(oldPending,newPending);
 }
 if(!definition.includes(newPending))throw Error('Unexpected retry progress; manual review required');
 return definition;
}
