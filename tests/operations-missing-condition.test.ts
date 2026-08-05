import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchesCondition, OPERATIONS_QUERY_SCHEMA, validateQueryPlan } from '../supabase/functions/operations-assistant/tools.ts';

assert.ok(OPERATIONS_QUERY_SCHEMA['납품방식'].filterOperators.includes('is_empty'));
assert.ok(OPERATIONS_QUERY_SCHEMA['진입방식'].filterOperators.includes('is_empty'));
assert.ok(OPERATIONS_QUERY_SCHEMA['납품장소'].filterOperators.includes('is_empty'));
assert.ok(OPERATIONS_QUERY_SCHEMA['코스등록']);

const emptyMethodPlan = validateQueryPlan({
  conditions: [{ field: '납품방식', operator: 'is_empty' }],
  select: ['코드', '납품처명', '납품방식'],
  sort: [],
  limit: 100
});
assert.equal(matchesCondition({ delivery_method: '' }, emptyMethodPlan.conditions[0]), true);
assert.equal(matchesCondition({ delivery_method: null }, emptyMethodPlan.conditions[0]), true);
assert.equal(matchesCondition({ delivery_method: '무인' }, emptyMethodPlan.conditions[0]), false);

const unregisteredPlan = validateQueryPlan({
  conditions: [{ field: '코스등록', operator: 'eq', value: false }],
  select: ['코드', '납품처명', '주소'],
  sort: [],
  limit: 100
});
assert.equal(matchesCondition({ __route_registered: false }, unregisteredPlan.conditions[0]), true);
assert.equal(matchesCondition({ __route_registered: true }, unregisteredPlan.conditions[0]), false);

const edge = fs.readFileSync('supabase/functions/operations-assistant/index.ts', 'utf8');
assert.match(edge, /patchPlanForMissingConditions/);
assert.match(edge, /fetchUnregisteredDeliveryPoints/);
assert.match(edge, /코스등록'&&condition\.operator==='eq'&&condition\.value===false/);
assert.match(edge, /납품방식이 공란인 거래처/);

console.log('operations assistant missing-condition support: ok');
