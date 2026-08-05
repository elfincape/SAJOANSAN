import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../repo-root/admin/one-top-two-room-work.html', import.meta.url), 'utf8');

assert.match(html, /compliance:14/);
assert.match(html, /temperaturePair:15/);
assert.match(html, /shipmentType:18/);
assert.match(html, /writeTemperatureAndDate\(ws,target\.row,item\.result\.date,temps,false\);\s*writeResultValues\(ws,target\.row\)/);
assert.match(html, /function computeResultValues\(freezerRaw,refrigeratedRaw\)/);
assert.match(html, /compliance:\(freezerBlank\|\|\(freezer!=null&&freezer<=-18\)\)&&\(refrigeratedBlank\|\|\(refrigerated!=null&&refrigerated>0&&refrigerated<10\)\)\?'준수':'미준수'/);
assert.match(html, /temperaturePair:\(!freezerBlank&&!refrigeratedBlank\)\?'O':'X'/);
assert.match(html, /shipmentType:!freezerBlank&&refrigeratedBlank\?'냉동 출고':freezerBlank&&!refrigeratedBlank\?'냉장 출고':''/);
assert.match(html, /COL\.compliance\)\.value=values\.compliance/);
assert.match(html, /COL\.temperaturePair\)\.value=values\.temperaturePair/);
assert.match(html, /COL\.shipmentType\)\.value=values\.shipmentType/);
assert.doesNotMatch(html, /\.value=\{formula:/);
assert.doesNotMatch(html, /fullCalcOnLoad|forceFullCalc/);

console.log('1탑2실 result values target N, O, and R columns: ok');
