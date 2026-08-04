import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const tools = readFileSync(new URL('../supabase/functions/operations-assistant/tools.ts', import.meta.url), 'utf8');
const widget = readFileSync(new URL('../repo-root/js/operations-assistant.js', import.meta.url), 'utf8');
const required=['호차','운수사','코스명','톤수','차량번호','운전자명','연락처','입차시간','하차시작','하차종료','납품마감','코드','납품처명','1톤이하','3.5톤이하','5톤이상','무인야적납','대면','검수','무인','보안키','열쇠','없음','창고','탑차','야적','주소','열쇠보관장소','비밀번호','비고'];

for(const label of required)assert.match(tools,new RegExp(`'${label}':\\{label:'${label}',column:`),`${label} schema missing`);
assert.match(tools, /'납품마감':\{label:'납품마감',column:'effective_deadline_business_min',type:'time'/);
assert.match(tools, /filterOperators:numberOps,aliases:\['마감','마감시간','납품시간','22시 이전 마감'\]/);
assert.match(tools, /'비밀번호':\{label:'비밀번호',column:'security_password'/);
assert.match(tools, /additionalColumns:\['secondary_driver_name'\]/);
assert.doesNotMatch(widget, /5톤 차량이 진입할 수 없는 납품처|23시 이전 마감|전화번호가 누락된 기사|코스별 납품처 수/);
assert.match(widget, /launch\.title='도우미'/);
assert.match(widget, /'도우미'/);

console.log('unified operations query schema and assistant UI: ok');
