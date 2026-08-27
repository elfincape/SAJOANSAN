import assert from 'node:assert/strict';
import {expandResultPlan} from '../supabase/functions/operations-assistant/result-plan.js';

const deliveryPoints=Array.from({length:236},(_,index)=>({id:index+1,코드:`C${String(index+1).padStart(3,'0')}`,납품처명:`납품처 ${index+1}`,지역:index%2?'경기':'서울',코스등록:index%3!==0}));
const snapshot={routes:[],deliveryPoints,drivers:[],vehicles:[],courseRows:[]};
const all=expandResultPlan({dataset:'deliveryPoints',conditions:[],select:['코드','납품처명'],sort:[{field:'코드',direction:'asc'}]},snapshot);
assert.equal(all.rows.length,236);
assert.deepEqual(all.rows[0],{코드:'C001',납품처명:'납품처 1'});
assert.equal(all.rows.at(-1).코드,'C236');

const filtered=expandResultPlan({dataset:'deliveryPoints',conditions:[{field:'지역',operator:'eq',value:'경기'},{field:'코스등록',operator:'eq',value:true}],select:['코드']},snapshot);
assert.equal(filtered.rows.length,deliveryPoints.filter(row=>row.지역==='경기'&&row.코스등록).length);

console.log('operations assistant full result-plan expansion checks passed');
