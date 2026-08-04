import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../repo-root/admin/one-top-two-room-work.html', import.meta.url), 'utf8');

assert.match(html, /compliance:14/);
assert.match(html, /temperaturePair:15/);
assert.match(html, /shipmentType:18/);
assert.match(html, /writeTemperatureAndDate\(ws,target\.row,item\.result\.date,temps,false\);\s*writeResultFormulas\(ws,target\.row\)/);
assert.match(html, /calcProperties\.fullCalcOnLoad=true; workbook\.calcProperties\.forceFullCalc=true/);
assert.match(html, /IF\(AND\(OR\(ISBLANK\(J\$\{row\}\),J\$\{row\}<=-18\),OR\(AND\(K\$\{row\}>0,K\$\{row\}<10\),ISBLANK\(K\$\{row\}\)\)\),"준수","미준수"\)/);
assert.match(html, /IF\(COUNTA\(J\$\{row\}:K\$\{row\}\)=2,"O","X"\)/);
assert.match(html, /IF\(AND\(J\$\{row\}<>"", K\$\{row\}=""\), "냉동 출고", IF\(AND\(J\$\{row\}="", K\$\{row\}<>""\), "냉장 출고", ""\)\)/);
assert.match(html, /COL\.compliance\)\.value=\{formula:formulas\.compliance\}/);
assert.match(html, /COL\.temperaturePair\)\.value=\{formula:formulas\.temperaturePair\}/);
assert.match(html, /COL\.shipmentType\)\.value=\{formula:formulas\.shipmentType\}/);

console.log('1탑2실 result formulas target N, O, and R columns: ok');
