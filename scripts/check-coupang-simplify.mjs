const ref=process.env.SUPABASE_PROJECT_REF,token=process.env.SUPABASE_ACCESS_TOKEN;
if(ref!=='vvrppotrnpwrwpwqaiet'||!token)throw Error('운영 인증 필요');
const query=`begin;
create temporary table coupang_input_probe(like public.operations_tasks including defaults);
create trigger validate_probe before insert or update on coupang_input_probe for each row execute function public.operations_validate_task_inputs();
do $probe$
declare actor uuid; spec jsonb; rejected boolean;
begin
 select id into actor from public.user_profiles where active and role='admin' limit 1;
 spec:='{"spec":{"integration":{"kind":"coupang_entry"},"fields":[{"key":"dispatch_info","label":"배차정보","type":"string","required_on_complete":true},{"key":"carrier_name","label":"전송 담당자","type":"string","required_on_complete":true}],"steps":[{"key":"carrier_sent","label":"전송"}]}}'::jsonb;
 insert into coupang_input_probe(center_code,title,work_date,owner_id,created_by,status,inputs,template_snapshot)
 values('001','쿠팡 입력 테스트',current_date,actor,actor,'completed','{"dispatch_info":"배차정보"}',spec);
 rejected:=false;
 begin
  insert into coupang_input_probe(center_code,title,work_date,owner_id,created_by,status,inputs,template_snapshot)
  values('001','필수 배차정보 테스트',current_date,actor,actor,'completed','{}',spec);
 exception when sqlstate '22023' then rejected:=true;end;
 if not rejected then raise exception '배차정보 필수 조건이 사라졌습니다';end if;
 spec:=spec #- '{spec,integration}';
 rejected:=false;
 begin
  insert into coupang_input_probe(center_code,title,work_date,owner_id,created_by,status,inputs,template_snapshot)
  values('001','일반 업무 조건 테스트',current_date,actor,actor,'completed','{"dispatch_info":"배차정보"}',spec);
 exception when sqlstate '22023' then rejected:=true;end;
 if not rejected then raise exception '일반 업무 완료 조건이 사라졌습니다';end if;
end $probe$;
select true as completion_conditions_passed;
rollback;`;
const response=await fetch('https://api.supabase.com/v1/projects/'+ref+'/database/query',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({query}),signal:AbortSignal.timeout(60000)});
if(!response.ok)throw Error('완료 조건 테스트 HTTP '+response.status+': '+await response.text());
console.log(JSON.stringify(await response.json()));
