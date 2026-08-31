import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../repo-root/admin/coupang-entry.html',import.meta.url),'utf8');

assert.match(source,/센터명 초성에 ㄱㅈㅇ이 들어가면 반드시 곤지암으로, ㅍㅌ이 들어가면 반드시 평택/);
assert.match(source,/compact\.includes\('ㄱㅈㅇ'\)\) return `곤지암\$\{suffix\}`/);
assert.match(source,/compact\.includes\('ㅍㅌ'\)\) return `평택\$\{suffix\}`/);
assert.match(source,/const suffix = \/b2b\|비투비\/i\.test\(text\) \? ' B2B' : ''/);

console.log('coupang center initial normalization checks passed');
