import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../repo-root/admin/one-top-two-room-work.html',import.meta.url),'utf8');

assert.match(source,/id="analysis-default-date" type="date"/,'analysis should expose a default date selector');
assert.match(source,/센터명 초성에 ㄱㅈㅇ이 들어가면[^\n]+반드시 곤지암/,'vision prompt should force ㄱㅈㅇ to 곤지암');
assert.match(source,/center_name:normalizeCenterName\(value\?\.center_name\)/,'API center name should be normalized');
assert.match(source,/includes\('ㄱㅈㅇ'\)\?'곤지암'/,'ㄱㅈㅇ should always normalize to 곤지암');
assert.match(source,/timeZone:'Asia\/Seoul'/,'default date should use Korean Standard Time');
assert.match(source,/Number\(parts\.hour\)>=19\?1:0/,'Korean Standard Time 19:00 through 23:59 should select the next date');
assert.match(source,/date:normalizeDate\(value\?\.date\)\|\|\$\('analysis-default-date'\)\.value/,'selected default date should fill missing receipt dates');

const dateFunctionSource=source.match(/function defaultKoreanDate\(now=new Date\(\)\) \{[^\n]+\}/)?.[0];
assert.ok(dateFunctionSource,'defaultKoreanDate function should be extractable');
const defaultKoreanDate=Function(`return (${dateFunctionSource.replace('function defaultKoreanDate','function')})`)();
assert.equal(defaultKoreanDate(new Date('2026-08-19T09:59:00Z')),'2026-08-19','Korean Standard Time 18:59 should use the current Korean date');
assert.equal(defaultKoreanDate(new Date('2026-08-19T10:00:00Z')),'2026-08-20','Korean Standard Time 19:00 should use the next Korean date');

console.log('one-top center and Korean date default checks passed');
