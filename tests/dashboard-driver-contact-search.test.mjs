import assert from 'node:assert/strict';
import fs from 'node:fs';

const dashboard=fs.readFileSync(new URL('../repo-root/js/dashboard.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../repo-root/index.html',import.meta.url),'utf8');
const viewSql=fs.readFileSync(new URL('../repo-root/sql/course-view-center-code.sql',import.meta.url),'utf8');

assert.match(dashboard,/renderDriverIdentity\(r\.primary_driver_name, r\.primary_driver_phone\)/,'dashboard should show the primary driver phone beside the name');
assert.match(dashboard,/renderDriverIdentity\(r\.secondary_driver_name, r\.secondary_driver_phone\)/,'dashboard should show the secondary driver phone beside the name');
assert.match(dashboard,/Object\.values\(r\)/,'dashboard search should inspect every scalar row column');
assert.match(dashboard,/hay\.replace\(\/\\D\/g, ''\)\.includes\(digits\)/,'phone search should ignore punctuation such as hyphens');
assert.match(dashboard,/const primaryDriver = renderDriverIdentity/,'detail modal should render primary driver contact');
assert.match(dashboard,/const secondaryDriver = renderDriverIdentity/,'detail modal should render secondary driver contact');
assert.match(index,/전체 컬럼 검색 \(기사명·전화번호 포함\)/,'search input should explain its full-column behavior');
assert.match(viewSql,/sd\.phone as secondary_driver_phone/,'course view should expose the secondary driver phone');

console.log('dashboard driver contacts and full-column search checks passed');
