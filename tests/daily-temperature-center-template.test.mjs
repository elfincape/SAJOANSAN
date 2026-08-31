import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('repo-root/admin/daily-temperature.html', 'utf8');
assert.match(html, /one-top-two-room-template_PYT\.xlsx/);
assert.match(html, /one-top-two-room-template\.xlsx/);
assert.match(html, /storedCenter === '002'/);
assert.match(html, /'pyeongtaek'/);
assert.match(html, /CENTER_TEMPLATE_CONFIG\.url/);
assert.match(html, /default-template-path/);
console.log('daily temperature center template tests passed');
