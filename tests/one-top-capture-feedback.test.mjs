import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../repo-root/admin/one-top-two-room-work.html',import.meta.url),'utf8');

assert.match(source,/triggerCaptureFeedback\(\);/,'camera capture should trigger feedback');
assert.match(source,/navigator\.vibrate\(30\)/,'mobile capture should use a short, weak vibration');
assert.match(source,/촬영됨 · \$\{state\.captures\.length\}장/,'visual feedback should confirm the updated capture count');
assert.match(source,/camera-frame\.capture-feedback::before/,'camera preview should flash after capture');
assert.match(source,/prefers-reduced-motion:reduce/,'capture animation should respect reduced-motion preferences');

console.log('one-top capture feedback checks passed');
