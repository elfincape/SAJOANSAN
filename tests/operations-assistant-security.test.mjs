import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const edge = readFileSync(new URL('../supabase/functions/operations-assistant/index.ts', import.meta.url), 'utf8');
const tools = readFileSync(new URL('../supabase/functions/operations-assistant/tools.ts', import.meta.url), 'utf8');

assert.match(edge, /authorization:`Bearer \$\{token\}`/);
assert.match(edge, /user_center_access/);
assert.match(edge, /center_code=eq\.\$\{c\}/);
assert.match(edge, /if\(access&&!access\.length\)return fail\('FORBIDDEN'/);
assert.doesNotMatch(edge, /SERVICE_ROLE/i);
assert.doesNotMatch(edge, /\.from\([^)]*\)\.(?:insert|update|upsert|delete)|\/rpc\//i);
assert.doesNotMatch(edge, /security_password/);
assert.doesNotMatch(edge, /maskPhone|phone_missing|연락처\(마스킹\)/);
assert.match(edge, /companyQuery/);
assert.match(edge, /secondary_driver_name/);
assert.match(edge, /function correctPlan/);
assert.match(tools, /search_course_rows.*list_routes.*search_delivery_points.*search_drivers.*search_vehicles/s);
assert.match(tools, /throw new Error\('unknown tool'\)/);
assert.match(tools, /Math\.min\(100,/);
assert.match(tools, /companyQuery/);

console.log('operations assistant security invariants: ok');
