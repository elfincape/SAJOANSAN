import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../repo-root/admin/one-top-two-room-work.html',import.meta.url),'utf8');

assert.match(source,/const DEFAULT_TEMPLATE_PATHS = \{ '001':'\/templates\/one-top-two-room-template\.xlsx', '002':'\/templates\/one-top-two-room-template_PYT\.xlsx' \}/);
assert.match(source,/DEFAULT_TEMPLATE_PATHS\[String\(window\.appCenterCode \|\| '001'\)\]/);
assert.match(source,/window\.addEventListener\('one-top-cloud-ready', \(\) => \{ refreshCloudStatus\(\); loadDefaultTemplate\(\); \}\)/);
assert.match(source,/await applyTemplateBuffer\(await response\.arrayBuffer\(\), path\.split\('\/'\)\.pop\(\)\)/);

console.log('one-top center template selection checks passed');
