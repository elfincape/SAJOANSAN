import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const dashboard=fs.readFileSync(new URL('../repo-root/js/dashboard.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../repo-root/index.html',import.meta.url),'utf8');
const viewSql=fs.readFileSync(new URL('../repo-root/sql/course-view-center-code.sql',import.meta.url),'utf8');

assert.match(dashboard,/Object\.values\(r\)/,'dashboard search should inspect every scalar row column');
assert.match(dashboard,/const primaryDriver = renderDriverIdentity/,'detail modal should render primary driver contact');
assert.match(dashboard,/const secondaryDriver = renderDriverIdentity/,'detail modal should render secondary driver contact');
assert.match(index,/전체 컬럼 검색 \(기사명·전화번호 포함\)/,'search input should explain its full-column behavior');
assert.match(viewSql,/sd\.phone as secondary_driver_phone/,'course view should expose the secondary driver phone');

console.log('dashboard driver contacts and full-column search checks passed');

const context = vm.createContext({ formatPhone: value => value || '' });
for (const name of ['escapeHtml', 'renderDriver', 'renderDriverContact', 'renderDriverIdentity', 'orderedColumns']) {
  const start = dashboard.indexOf('function ' + name + '(');
  const end = dashboard.indexOf('\n}', start) + 2;
  vm.runInContext(dashboard.slice(start, end), context);
}
const row = {
  primary_driver_name: '주기사', primary_driver_phone: '010-1234-5678',
  secondary_driver_name: '보조기사', secondary_driver_phone: '010-9876-5432'
};
assert.doesNotMatch(context.renderDriver(row), /010-/);
assert.match(context.renderDriver(row), /주기사/);
assert.match(context.renderDriver(row), /보조기사/);
assert.match(context.renderDriverContact(row), /010-1234-5678/);
assert.match(context.renderDriverContact(row), /010-9876-5432/);
assert.equal(context.renderDriverContact({}), '-');
assert.doesNotMatch(dashboard, /tel:/);
assert.match(dashboard, /key: 'primary_driver_phone'.*label: '기사 연락처'/);
context.COL_MAP = Object.fromEntries(['primary_driver_name', 'primary_driver_phone', 'stop_order'].map(key => [key, { key }]));
context.ALL_KEYS = Object.keys(context.COL_MAP);
context.state = { colOrder: ['primary_driver_name', 'stop_order'] };
assert.equal(context.orderedColumns().map(c => c.key).join(','), 'primary_driver_name,primary_driver_phone,stop_order');
context.state.colOrder = ['primary_driver_phone', 'stop_order', 'primary_driver_name'];
assert.equal(context.orderedColumns().map(c => c.key).join(','), 'primary_driver_phone,stop_order,primary_driver_name');
console.log('driver contact columns, saved order and plain text checks passed');
