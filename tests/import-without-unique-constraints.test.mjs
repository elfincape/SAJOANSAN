import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../repo-root/admin/import.html', import.meta.url), 'utf8');
const companyBlock = html.slice(html.indexOf('/* 1) 회사 */'), html.indexOf('/* 2) 기사'));
const pointBlock = html.slice(html.indexOf('/* 4) 납품처 */'), html.indexOf('/* 5) 코스'));
const driverBlock = html.slice(html.indexOf('/* 2) 기사'), html.indexOf('/* 3) 차량'));
const vehicleBlock = html.slice(html.indexOf('/* 3) 차량'), html.indexOf('/* 4) 납품처'));

assert.doesNotMatch(companyBlock, /\.upsert\(/);
assert.doesNotMatch(companyBlock, /onConflict/);
assert.match(companyBlock, /\.eq\('center_code', selectedCenter\.code\)/);
assert.match(companyBlock, /\.from\('companies'\)\.insert/);
assert.doesNotMatch(pointBlock, /\.upsert\(/);
assert.doesNotMatch(pointBlock, /onConflict/);
assert.match(pointBlock, /\.eq\('center_code', selectedCenter\.code\)/);
assert.match(pointBlock, /\.from\('delivery_points'\)\.update/);
assert.match(pointBlock, /\.from\('delivery_points'\)[\s\S]*\.insert\(inserts\)/);
assert.match(driverBlock, /drivers legacy select/);
assert.match(driverBlock, /centerPayload\(\{ phone: d\.phone, contact: d\.contact \}, selectedCenter\)/);
assert.match(vehicleBlock, /vehicles legacy select/);
assert.match(vehicleBlock, /eqNullable\(legacyQuery, 'company_id', compId\)/);
assert.doesNotMatch(vehicleBlock, /\.update\(centerPayload\([\s\S]{0,180}\.eq\('center_code', selectedCenter\.code\)/);

console.log('CSV import works without ON CONFLICT constraints: ok');
