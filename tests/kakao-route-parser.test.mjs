import assert from 'node:assert/strict';
import fs from 'node:fs';

const page=fs.readFileSync(new URL('../repo-root/admin/ansan-gimhae-busan-ansan.html',import.meta.url),'utf8');
const hub=fs.readFileSync(new URL('../repo-root/admin/index.html',import.meta.url),'utf8');
const edge=fs.readFileSync(new URL('../supabase/functions/kakao-route-parser/index.ts',import.meta.url),'utf8');
const parser=fs.readFileSync(new URL('../supabase/functions/kakao-route-parser/parser.ts',import.meta.url),'utf8');
const workflow=fs.readFileSync(new URL('../.github/workflows/deploy-supabase-functions.yml',import.meta.url),'utf8');

assert.match(hub,/ansan-gimhae-busan-ansan\.html[^\n]+title: '안산김해부산안산'/,'admin hub should expose the new tool');
assert.match(page,/accept="\.txt,text\/plain"/,'tool should accept KakaoTalk text exports');
assert.match(page,/Promise\.all\(\[requestDirection\('ansan-gimhae',headers\),requestDirection\('busan-ansan',headers\)\]\)/,'both directions must use separate API calls');
assert.match(page,/function combineDirections\(ansanGimhae,busanAnsan\)/,'separate API results should be combined in the browser');
assert.match(page,/\['일자','요일','1호차','2호차','', '일자','요일','1호차','2호차'\]/,'Excel should leave one column between route tables');
assert.match(edge,/\$\{routeName\}으로 시작하는 메시지만 사용하고 다른 방향은 완전히 무시/,'each API call should isolate one direction');
assert.match(edge,/숫자\+p 또는 숫자\+P의 숫자를 팔레트 수로 사용/,'AI prompt should retain the last pallet count');
assert.match(edge,/mergeDirectionRows\(normalizeRows\(parsed\?\.rows\),baseline\)/,'deterministic direction values should fill API omissions');
assert.match(parser,/const direction=.*안산.*김해.*\?.*ansanGimhae.*부산.*안산.*\?.*busanAnsan/s,'baseline parser should identify both directions independently');
assert.match(parser,/function lastPallet\(body:string\)/,'baseline parser should capture the last p value');
assert.match(edge,/const MODEL='claude-haiku-4-5-20251001'/,'parser should use Haiku 4.5');
assert.match(workflow,/supabase functions deploy kakao-route-parser/,'CI should deploy the parser function');

console.log('kakao route parser integration checks passed');
