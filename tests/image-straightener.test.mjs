import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const page=readFileSync(new URL('../repo-root/admin/image-straightener.html',import.meta.url),'utf8');
const hub=readFileSync(new URL('../repo-root/admin/index.html',import.meta.url),'utf8');

assert.match(hub,/image-straightener\.html/, 'management hub should link to the image straightener');
assert.match(hub,/title: '기울기 보정'/, 'management hub should use the requested feature name');
assert.match(page,/clipboardData\.items/, 'clipboard images should be accepted');
assert.match(page,/paste-target'\)\.addEventListener\('click',[^\n]+\.focus\(\)/, 'clicking the plus target should prepare it for pasting');
assert.match(page,/event\.key==='ArrowLeft'/, 'left keyboard navigation should be available');
assert.match(page,/event\.key==='ArrowRight'/, 'right keyboard navigation should be available');
assert.match(page,/type="range" min="-90" max="90" step="0\.1"/, 'rotation slider should support fine correction');
assert.match(page,/style\.transform=`rotate\(\$\{value\}deg\)`/, 'slider value should rotate the displayed image');
assert.match(page,/max-width:90%;max-height:90%;object-fit:contain/, 'photo should use the available stage without overlapping controls');

console.log('image straightener checks passed');
