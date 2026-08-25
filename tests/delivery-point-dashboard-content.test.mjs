import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const dashboard=readFileSync(new URL('../repo-root/js/dashboard.js',import.meta.url),'utf8');
const exportPage=readFileSync(new URL('../repo-root/admin/export.html',import.meta.url),'utf8');
const viewSql=readFileSync(new URL('../repo-root/sql/course-view-center-code.sql',import.meta.url),'utf8');

assert.match(viewSql,/dp\.memo as dp_memo/, 'course_view should expose the delivery-point memo');
assert.match(dashboard,/select\('id,memo'\)/, 'dashboard should load delivery-point memos when the view has not been migrated');
assert.match(dashboard,/function deliveryPointMemo\(r\)/, 'dashboard should merge delivery-point and route-stop memos');
assert.match(dashboard,/select\('code,name,address,region,contact,[^']+photos,memo'\)/, 'detail popup should refresh delivery-point data, photos, and memo');
assert.match(dashboard,/id="detail-memo"/, 'detail popup should expose a memo target for refresh');
assert.match(dashboard,/id="detail-save"/, 'detail popup should provide a delivery-point save action');
assert.match(dashboard,/from\('delivery_points'\)\.update\(payload\)\.eq\('id', r\.delivery_point_id\)/, 'detail edits should update only the selected delivery point');
assert.match(dashboard,/scopeByCenter\([\s\S]*?from\('delivery_points'\)\.update\(payload\)/, 'detail updates should remain center scoped');
assert.match(dashboard,/data-detail-photo-remove/, 'detail popup should allow delivery-point photos to be removed');
assert.match(dashboard,/compressDeliveryPointPhoto\(file\)/, 'new detail photos should be compressed before saving');
assert.match(exportPage,/\[dp\.memo, stop\.memo\]\.filter\(Boolean\)\.join\('\\n'\)/, 'downloads should include delivery-point and route-stop memos');
assert.doesNotMatch(exportPage,/delivery_point:delivery_points\([\s\S]*?photos/, 'downloads should not include delivery-point photos');

console.log('delivery-point dashboard content checks passed');
