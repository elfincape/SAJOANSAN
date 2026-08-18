import assert from 'node:assert/strict';
import {mergeRouteRows,parseKakaoBaseline} from '../supabase/functions/kakao-route-parser/parser.ts';

const sample=`--------------- 2026년 7월 16일 목요일 ---------------
[박준수] [오전 4:35] 안산-김해 경기91아6175 박준수 010-7930-3625
04:10 도착 04:30 하차완료
[장호연] [오전 8:47] 부산-안산 경기94자7146 장호연 010-7543-6438
12p
[박준수] [오전 8:51] 부산-안산 경기91아6175 박준수 010-7930-3625
10P
[박준수] [오후 7:05] 안산-김해 경기91아6175 박준수 010-7930-3625
19:00 출발 01:00 도착예정
10p
[장호연] [오후 9:10] 안산-김해 경기94사7146 장호연 010-7543-6438
출발 21:10
도착예정 03:30
10p`;

const baseline=parseKakaoBaseline(sample);
assert.deepEqual(baseline,[{date:'2026-07-16',weekday:'목요일',ansanGimhae1:10,ansanGimhae2:10,busanAnsan1:12,busanAnsan2:10}]);
assert.deepEqual(mergeRouteRows([{...baseline[0],busanAnsan1:'',busanAnsan2:''}],baseline),baseline,'API omissions must not erase Busan-Ansan values');

console.log('kakao route parser engine checks passed');
