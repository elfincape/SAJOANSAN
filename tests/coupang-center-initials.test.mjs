import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../repo-root/admin/coupang-entry.html',import.meta.url),'utf8');

assert.match(source,/ㅍㅌ 뒤의 숫자는 보존해라/);
assert.match(source,/compact\.includes\('ㄱㅈㅇ'\)\) return `곤지암\$\{suffix\}`/);
assert.match(source,/const numberSuffix = compact\.match\(\/ㅍㅌ\(\\d\+\)\/\)\?\.\[1\] \|\| ''/);
assert.match(source,/return `평택\$\{numberSuffix\}\$\{suffix\}`/);
assert.match(source,/const suffix = \/b2b\|비투비\/i\.test\(text\) \? ' B2B' : ''/);

console.log('coupang center initial normalization checks passed');
