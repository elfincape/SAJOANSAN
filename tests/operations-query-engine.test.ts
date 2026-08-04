import assert from 'node:assert/strict';
import {displayFieldValue,matchesCondition,OPERATIONS_QUERY_SCHEMA,validateQueryPlan} from '../supabase/functions/operations-assistant/tools.ts';

const row={route_name:'대-11호',company_name:'OO운수',effective_deadline_business_min:1290,allow_over_5ton:true,delivery_method:'무인',delivery_location:'야적',dp_name:'테스트마트',dp_contact:'01012345678',dp_address:'안산시',primary_driver_name:'홍길동',secondary_driver_name:'김보조',security_password:'1234'};
const plan=validateQueryPlan({conditions:[{field:'코스명',operator:'eq',value:'대-11호'},{field:'5톤이상',operator:'eq',value:true},{field:'무인',operator:'eq',value:true}],select:['코스명','납품처명','납품마감','비밀번호'],sort:[],limit:100});
assert.equal(plan.conditions.every(condition=>matchesCondition(row,condition)),true);
assert.equal(matchesCondition(row,{field:'납품마감',operator:'lt',value:1320}),true);
assert.equal(matchesCondition(row,{field:'야적',operator:'eq',value:true}),true);
assert.equal(matchesCondition(row,{field:'운수사',operator:'contains',value:'OO'}),true);
assert.equal(displayFieldValue(row,OPERATIONS_QUERY_SCHEMA['납품마감']),'21:30');
assert.equal(displayFieldValue(row,OPERATIONS_QUERY_SCHEMA['운전자명']),'홍길동, 김보조');
assert.equal(displayFieldValue(row,OPERATIONS_QUERY_SCHEMA['비밀번호']),'1234');
assert.throws(()=>validateQueryPlan({conditions:[{field:'없는필드',operator:'eq',value:'x'}],select:['코스명'],sort:[],limit:1}),/확인할 수 없는 컬럼/);

console.log('unified operations query filtering: ok');
