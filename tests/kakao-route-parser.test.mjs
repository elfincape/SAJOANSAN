import assert from 'node:assert/strict';
import fs from 'node:fs';

const page=fs.readFileSync(new URL('../repo-root/admin/ansan-gimhae-busan-ansan.html',import.meta.url),'utf8');
const hub=fs.readFileSync(new URL('../repo-root/admin/index.html',import.meta.url),'utf8');
const edge=fs.readFileSync(new URL('../supabase/functions/kakao-route-parser/index.ts',import.meta.url),'utf8');
const workflow=fs.readFileSync(new URL('../.github/workflows/deploy-supabase-functions.yml',import.meta.url),'utf8');

assert.match(hub,/ansan-gimhae-busan-ansan\.html[^\n]+title: '안산김해부산안산'/,'admin hub should expose the new tool');
assert.match(page,/accept="\.txt,text\/plain"/,'tool should accept KakaoTalk text exports');
assert.match(page,/functions\/v1\/kakao-route-parser/,'text organization must call the API');
assert.match(page,/\['일자','요일','1호차','2호차','', '일자','요일','1호차','2호차'\]/,'Excel should leave one column between route tables');
assert.match(edge,/최초 등장 순서에 따라 1호차, 2호차/,'AI prompt should assign trucks by first appearance');
assert.match(edge,/마지막으로 나온 숫자\+p 값을 팔레트 수로 사용/,'AI prompt should retain the last pallet count');
assert.match(edge,/const MODEL='claude-haiku-4-5-20251001'/,'parser should use Haiku 4.5');
assert.match(workflow,/supabase functions deploy kakao-route-parser/,'CI should deploy the parser function');

console.log('kakao route parser integration checks passed');
