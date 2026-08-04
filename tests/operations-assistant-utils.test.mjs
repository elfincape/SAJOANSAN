import assert from 'node:assert/strict';
import {buildTsv,sanitizeTsvCell,normalizeAssistantResponse} from '../repo-root/js/operations-assistant-utils.js';
assert.equal(sanitizeTsvCell('a\tb\nc'),'a b c');
for(const value of ['=HYPERLINK("x")','+cmd','-1+1','@SUM(A1)'])assert.equal(sanitizeTsvCell(value),`'${value}`);
assert.equal(sanitizeTsvCell(123,'number'),'123');
assert.equal(buildTsv([{key:'vehicle',label:'차량번호',type:'text'},{key:'count',label:'수',type:'number'}],[{vehicle:'0123',count:2}]),'차량번호\t수\n0123\t2');
const safe=normalizeAssistantResponse({answer:'<img onerror=alert(1)>',columns:[{key:'x',label:'X'}],rows:[{x:'<script>'}],notices:[],meta:{}});assert.equal(safe.answer,'<img onerror=alert(1)>');assert.equal(safe.rows[0].x,'<script>');
console.log('operations assistant utils tests passed');
