import ExcelJS from 'exceljs';
import { courseTitle } from '../domain/naver-courses';
import type { NaverCourse } from '../domain/naver-courses';
import type { CaptureJob, CourseCapture } from './naver-courses';

const meters = (n: unknown): n is number =>
  typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
export function courseLegRows(course: NaverCourse, result?: CourseCapture) {
  const fixed = course.rotation === 2 ? 1 : 2,
    chosen = result?.orderedStops;
  const sameOrder =
    !!chosen &&
    chosen.length === course.stops.length &&
    chosen.slice(0, fixed).every((s, i) => s === course.stops[i]) &&
    chosen.at(-1) === course.stops.at(-1) &&
    JSON.stringify([...chosen].sort()) ===
      JSON.stringify([...course.stops].sort());
  const stops = sameOrder ? chosen! : course.stops,
    evidence = result?.legEvidence;
  const completed =
    !!result?.imagePath &&
    !!result.optimization?.complete &&
    result.optimization.completed === result.optimization.total &&
    Array.isArray(result.optimization.failed) &&
    !result.optimization.failed.length;
  const bound =
    sameOrder &&
    completed &&
    result?.requestedStops?.every((s, i) => s === stops[i]) &&
    result.requestedStops.length === stops.length &&
    evidence?.source === 'naver-same-route-response' &&
    Array.isArray(evidence.distancesMeters) &&
    evidence.distancesMeters.length === stops.length - 1;
  const totalMeters = meters(result?.distanceMeters)
    ? result.distanceMeters
    : null;
  const verified =
    !!bound &&
    !!evidence?.verified &&
    totalMeters !== null &&
    evidence.totalMeters === totalMeters &&
    evidence.distancesMeters.every(meters) &&
    evidence.distancesMeters.reduce<number>((sum, n) => sum + n!, 0) ===
      totalMeters;
  const issue =
    result?.issue ||
    (!completed
      ? '최단 캡처 미완료'
      : !sameOrder
        ? '선택 순서 미확인'
        : !evidence
          ? '이전 캡처 · 구간자료 없음'
          : evidence.issue || '동일 경로 구간 합계 미확인');
  const rows = stops.map((address, i) => {
    const distance = i && bound ? evidence!.distancesMeters[i - 1] : null;
    const role =
      i === 0
        ? course.rotation === 2
          ? '센터(출발)'
          : '차고지(출발)'
        : i === stops.length - 1
          ? course.rotation === 1
            ? '센터(복귀)'
            : '차고지(복귀)'
          : i < fixed
            ? '센터'
            : `납품처 ${i - fixed + 1}`;
    return {
      address,
      role,
      confirmedAddress: sameOrder ? result?.confirmedAddresses?.[i] || '' : '',
      distanceKm: i && meters(distance) ? distance / 1000 : null,
      status: !i
        ? '출발 · 이전 구간 없음'
        : verified
          ? evidence?.logicalPointMapping?.logicalToMap[i] ===
            evidence?.logicalPointMapping?.logicalToMap[i - 1] &&
            !!evidence?.logicalPointMapping
            ? '확인: 직전 방문과 동일 좌표 · 0m'
            : '확인'
          : meters(distance)
            ? '원시값 · 합계 미확인'
            : '미확인: ' + issue,
    };
  });
  return {
    rows,
    verified,
    issue,
    totalMeters,
    displayedDistance: result?.distanceText || '',
  };
}

export async function courseDistanceWorkbook(
  job: CaptureJob,
  courseIds?: string[],
) {
  const courses = job.courses.filter(
    (c) => !courseIds || courseIds.includes(c.id),
  );
  if (!courses.length) throw Error('출력할 코스가 없습니다.');
  const book = new ExcelJS.Workbook();
  book.creator = 'SAJOANSAN';
  book.calcProperties.fullCalcOnLoad = true;
  for (const [index, course] of courses.entries()) {
    const result = job.results[course.id],
      data = courseLegRows(course, result);
    const name = `${index + 1}_${courseTitle(course)}`
      .replace(/[\\/:*?\[\]]/g, '_')
      .slice(0, 31);
    const sheet = book.addWorksheet(name, {
      views: [{ showGridLines: false }],
      pageSetup: {
        paperSize: 9,
        orientation: 'landscape',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 1,
        margins: {
          left: 0.25,
          right: 0.25,
          top: 0.3,
          bottom: 0.3,
          header: 0.15,
          footer: 0.15,
        },
      },
    });
    [6, 15, 39, 39, 19, 30].forEach((width, i) => {
      sheet.getColumn(i + 1).width = width;
    });
    sheet.getCell('A2').value = courseTitle(course);
    sheet.getCell('A2').font = { name: '맑은 고딕', size: 14, bold: true };
    sheet.getRow(2).height = 25;
    sheet.getCell('A3').value = '선택 옵션';
    sheet.getCell('C3').value = result?.routeLabel || '미확인';
    sheet.getCell('E3').value = '전체거리(km)';
    sheet.getCell('F3').value =
      data.totalMeters === null ? null : data.totalMeters / 1000;
    sheet.getCell('A4').value = '비교 결과';
    sheet.getCell('C4').value = result?.optimization?.complete
      ? `${result.optimization.completed}개 납품 순서 비교 완료`
      : '최단 검증 미완료';
    sheet.getCell('E4').value = '구간합계(km)';
    sheet.getCell('A5').value = '조회시각(KST)';
    const at = result?.measuredAt ? new Date(result.measuredAt) : null;
    sheet.getCell('C5').value =
      at && Number.isFinite(at.getTime())
        ? new Date(at.getTime() + 9 * 3600000)
        : null;
    sheet.getCell('C5').numFmt = 'yyyy-mm-dd hh:mm:ss';
    sheet.getCell('E5').value = '차이(m)';
    sheet.getCell('A6').value = '화면 표시';
    sheet.getCell('C6').value = data.displayedDistance || '미확인';
    sheet.getCell('E6').value = '원시 합계 검증';
    sheet.getCell('A7').value =
      result?.legEvidence?.logicalPointMapping
        ? '원본 방문은 모두 유지합니다. 연속 동일 좌표는 지도에서 한 점으로 계산하며 해당 구간만 0m입니다. 나머지는 같은 선택 경로의 구간입니다.'
        : '원문과 네이버 확인 주소를 구분합니다. km 소수 셋째 자리(1m). 첫 지점에는 이전 구간이 없으며 미확인 구간은 빈칸입니다.';
    sheet.getCell('A7').font = { name: '맑은 고딕', size: 9, italic: true };
    sheet.getRow(7).height = 20;
    sheet.getRow(8).values = [
      '순서',
      '지점 역할',
      '주소 원문',
      '네이버 확인 주소',
      '직전 구간거리(km)',
      '확인 상태',
    ];
    sheet.getRow(8).height = 26;
    const first = 9,
      last = first + data.rows.length - 1;
    data.rows.forEach((row, i) => {
      const target = sheet.getRow(first + i);
      target.values = [
        i + 1,
        row.role,
        row.address,
        row.confirmedAddress,
        row.distanceKm,
        row.status,
      ];
      const width = (s: string) =>
        [...s].reduce((n, c) => n + (c.charCodeAt(0) > 255 ? 2 : 1), 0);
      target.height = Math.max(
        38,
        Math.ceil(
          Math.max(
            width(row.address),
            width(row.confirmedAddress),
            width(row.status),
          ) / 36,
        ) *
          14 +
          10,
      );
      target.eachCell({ includeEmpty: true }, (cell, column) => {
        cell.alignment = {
          vertical: 'middle',
          horizontal: column === 1 || column === 5 ? 'right' : 'left',
          wrapText: true,
        };
      });
      if (i === data.rows.length - 1)
        target.eachCell({ includeEmpty: true }, (cell) => {
          cell.border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
        });
      sheet.getCell(first + i, 5).numFmt = '0.000';
    });
    if (data.verified) {
      const count = data.rows.length - 1,
        total = data.totalMeters! / 1000;
      sheet.getCell('F4').value = {
        formula: `IF(COUNT(E${first + 1}:E${last})=${count},SUM(E${first + 1}:E${last}),"미확인")`,
        result: total,
      };
      sheet.getCell('F5').value = {
        formula:
          'IF(AND(ISNUMBER(F3),ISNUMBER(F4)),ROUND((F4-F3)*1000,0),"검증불가")',
        result: 0,
      };
      sheet.getCell('F6').value = {
        formula: 'IF(NOT(ISNUMBER(F5)),"미확인",IF(F5=0,"일치","합계 불일치"))',
        result: '일치',
      };
    } else {
      sheet.getCell('F4').value = '미확인';
      sheet.getCell('F5').value = '검증불가';
      sheet.getCell('F6').value = data.issue;
      sheet.getRow(6).height = 32;
      sheet.getCell('F6').alignment = { wrapText: true };
    }
    for (const cell of ['F3', 'F4']) sheet.getCell(cell).numFmt = '0.000';
    sheet.getCell('F5').numFmt = '0';
    sheet.getCell(last + 2, 1).value =
      `원본: ${course.sourceSheet || '시트'} ${(course.sourceRows || [course.sourceRow]).join(', ')}행`;
    if (result?.sourceUrl?.startsWith('https://map.naver.com/'))
      sheet.getCell(last + 2, 3).value = {
        text: '조회 시점의 네이버 경로 열기',
        hyperlink: result.sourceUrl,
      };
    sheet.eachRow((row) =>
      row.eachCell({ includeEmpty: true }, (cell) => {
        if (!cell.font?.size) cell.font = { name: '맑은 고딕', size: 10 };
        cell.alignment = { vertical: 'middle', ...cell.alignment };
      }),
    );
    sheet.getRow(8).eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF243B53' },
      };
      cell.font = {
        name: '맑은 고딕',
        size: 10,
        bold: true,
        color: { argb: 'FFFFFFFF' },
      };
      cell.alignment = {
        horizontal: 'center',
        vertical: 'middle',
        wrapText: true,
      };
    });
    sheet.addConditionalFormatting({
      ref: 'F5',
      rules: [
        {
          type: 'expression',
          formulae: ['AND(ISNUMBER(F5),F5<>0)'],
          priority: 1,
          style: { font: { color: { argb: 'FFB91C1C' }, bold: true } },
        },
      ],
    });
    sheet.pageSetup.printArea = `A1:F${last + 2}`;
  }
  return book;
}
