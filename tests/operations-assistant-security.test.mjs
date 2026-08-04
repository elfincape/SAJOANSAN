import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const edge = readFileSync(new URL('../supabase/functions/operations-assistant/index.ts', import.meta.url), 'utf8');
const tools = readFileSync(new URL('../supabase/functions/operations-assistant/tools.ts', import.meta.url), 'utf8');

assert.match(edge, /authorization:`Bearer \$\{token\}`/);
assert.match(edge, /user_center_access/);
assert.match(edge, /center_code=eq\.\$\{center\}/);
assert.match(edge, /if\(access&&!access\.length\)return fail\('FORBIDDEN'/);
assert.doesNotMatch(edge, /SERVICE_ROLE/i);
assert.doesNotMatch(edge, /\.(?:insert|update|upsert|delete)\(|\/rpc\//i);
assert.match(edge, /name:'search_operations'/);
assert.doesNotMatch(edge, /search_course_rows|search_delivery_points|search_drivers|search_vehicles|list_routes/);
assert.match(edge, /plan\.conditions\.every\(condition=>matchesCondition\(row,condition\)\)/);
assert.match(tools, /OPERATIONS_QUERY_SCHEMA/);
assert.match(tools, /Math\.min\(100,/);
assert.match(tools, /확인할 수 없는 컬럼/);

console.log('operations assistant security invariants: ok');
