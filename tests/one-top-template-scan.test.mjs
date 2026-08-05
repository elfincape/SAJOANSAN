import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../repo-root/admin/one-top-two-room-work.html', import.meta.url), 'utf8');

assert.match(html, /const TEMPLATE_SCAN_BUFFER_ROWS = 120;/);
assert.match(html, /const TEMPLATE_MIN_SCAN_ROWS = 1000;/);
assert.match(html, /const TEMPLATE_MAX_SCAN_ROWS = 3000;/);
assert.match(html, /const TEMPLATE_EMPTY_TAIL_ROWS = 120;/);
assert.match(html, /ws\.dimensions\?\.bottom/);
assert.match(html, /Array\.isArray\(ws\._rows\)\?ws\._rows\.length:0/);
assert.match(html, /scanLast=Math\.min\(TEMPLATE_MAX_SCAN_ROWS,Math\.max\(baseLast\+TEMPLATE_SCAN_BUFFER_ROWS,TEMPLATE_MIN_SCAN_ROWS\)\)/);
assert.match(html, /scanLast=Math\.min\(TEMPLATE_MAX_SCAN_ROWS,Math\.max\(scanLast,row\+TEMPLATE_SCAN_BUFFER_ROWS\)\)/);
assert.match(html, /cell\?\.isMerged&&cell\.master\?cell\.master:cell/);

console.log('1탑2실 template vehicle scan buffer: ok');
