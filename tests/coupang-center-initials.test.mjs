import assert from 'node:assert/strict';
import { loadCoupangPage } from './helpers/coupang-page.mjs';

const { context: page } = loadCoupangPage();

for (const [input, expected] of [
  ['ㅍㅌ', '평택'], ['ㅍㅌ2', '평택2'], ['ㅍㅌ 12 B2B', '평택12 B2B'],
  ['ㅍㅌ2 비투비', '평택2 B2B'], ['ㄱㅈㅇ2', '곤지암2'],
  ['군지암', '곤지암'], ['ㅍㅌ2/3', '평택2/3'], ['ㅍㅌ2+ㄱㅈㅇ', '평택2+곤지암']
]) assert.equal(page.normalizeCenterName(input), expected, input);

for (const [input, expected] of [
  ['ㅍㅌ2/3', ['평택2', '평택3']],
  ['ㅍㅌ2+ㄱㅈㅇ', ['평택2', '곤지암']],
  ['평택2 B2B', ['평택2 B2B']],
  ['평택2/B2B', ['평택2', '평택2 B2B']],
  ['인천12/14 B2B', ['인천12', '인천14 B2B']],
  ['평택 2/3', ['평택2', '평택3']],
  ['곤지암/평택2', ['곤지암', '평택2']]
]) assert.deepEqual(Array.from(page.expandCenterExpression(input), row => row.label), expected, input);

const dispatch = page.parseDispatchText('평택 5톤\n일반기사 1111\n01011111111\n평택2 5톤\n2센터기사 2222\n01022222222\n평택2 B2B 5톤\n전용기사 3333\n01033333333');
const row = page.normalizeScheduleRow({ centerRaw: 'ㅍㅌ2', centerBase: '평택', reservationTime: '09:00' }, 0);
assert.equal(row.centerBase, '평택2');
assert.equal(page.matchScheduleToDispatch(row, dispatch).matchedDispatch.driver, '2센터기사');
const b2b = page.normalizeScheduleRow({ centerRaw: 'ㅍㅌ2 비투비', centerBase: '평택', isB2B: false }, 0);
assert.equal(b2b.isB2B, true);
assert.equal(page.matchScheduleToDispatch(b2b, dispatch).matchedDispatch.driver, '전용기사');
const flagged = page.normalizeScheduleRow({ centerRaw: '평택2', isB2B: true }, 0);
assert.equal(flagged.centerRaw, '평택2 B2B');
assert.equal(page.matchScheduleToDispatch(flagged, dispatch).matchedDispatch.driver, '전용기사');
assert.equal(page.matchScheduleToDispatch(row, dispatch.filter(d => d.isB2B)).matchedDispatch, null);
assert.equal(page.normalizeScheduleRow({ centerRaw: '평택2', isB2B: 'false' }, 0).isB2B, false);

console.log('coupang normalization and dispatch matching checks passed');
