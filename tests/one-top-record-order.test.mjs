import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../repo-root/admin/one-top-two-room-work.html', import.meta.url), 'utf8');
const match = html.match(/function selectRecord\(records\) \{([^}]*)\}/);
assert.ok(match, 'selectRecord function must exist');
const selectRecord = new Function('records', match[1]);

const differentTimes = [{time:'12:30',a:5},{time:'12:20',a:6}];
const sameTimes = [{time:'12:30',a:5},{time:'12:30',a:6}];
assert.equal(selectRecord(differentTimes), differentTimes[0]);
assert.equal(selectRecord(sameTimes), sameTimes[0]);
assert.equal(selectRecord([null, differentTimes[0]]), differentTimes[0]);
assert.equal(selectRecord([]), null);
assert.doesNotMatch(match[1], /sort|localeCompare|at\(-1\)/);
assert.match(html, /위에서 아래 순서를 그대로 유지/);
assert.match(html, /같은 시간이 여러 줄이어도 맨 윗줄을 우선/);

console.log('1탑2실 representative record uses the top receipt row: ok');
