import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../repo-root/admin/import.html', import.meta.url), 'utf8');
const companyBlock = html.slice(html.indexOf('/* 1) 회사 */'), html.indexOf('/* 2) 기사'));
const pointBlock = html.slice(html.indexOf('/* 4) 납품처 */'), html.indexOf('/* 5) 코스'));

assert.doesNotMatch(companyBlock, /\.upsert\(/);
assert.doesNotMatch(companyBlock, /onConflict/);
assert.match(companyBlock, /\.eq\('center_code', selectedCenter\.code\)/);
assert.match(companyBlock, /\.from\('companies'\)\.insert/);
assert.doesNotMatch(pointBlock, /\.upsert\(/);
assert.doesNotMatch(pointBlock, /onConflict/);
assert.match(pointBlock, /\.eq\('center_code', selectedCenter\.code\)/);
assert.match(pointBlock, /\.from\('delivery_points'\)\.update/);
assert.match(pointBlock, /\.from\('delivery_points'\)[\s\S]*\.insert\(inserts\)/);

console.log('CSV import works without ON CONFLICT constraints: ok');
