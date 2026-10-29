import { supabase } from './supabase';
import { courseTitle } from '../domain/naver-courses';
import type { NaverCourse } from '../domain/naver-courses';
export interface CourseCapture {
  imagePath?: string;
  sourceUrl?: string;
  distanceText?: string;
  distanceKm?: number;
  distanceMeters?: number;
  routeLabel?: string;
  measuredAt?: string;
  issue?: string;
  orderedStops?: string[];
  requestedStops?: string[];
  resolvedStops?: string[];
  confirmedAddresses?: string[];
  legEvidence?: {
    source: string;
    verified: boolean;
    distancesMeters: (number | null)[];
    totalMeters: number;
    issue?: string;
    logicalPointMapping?: {
      mapStops: string[];
      logicalToMap: number[];
      coordinates: number[][];
      mapDistancesMeters: (number | null)[];
    };
  };
  metrics?: {
    elapsedMs: number;
    uploadMs?: number;
    addressQueries: number;
    routeRequests: number;
  };
  addressReason?: string;
  providerUnavailable?: boolean;
  httpStatus?: number;
  optimization?: {
    version: number;
    policy: string;
    complete: boolean;
    total: number;
    completed: number;
    current?: number;
    failed: { index: number; code: string }[];
  };
}
export function captureVerificationLabel(result?: CourseCapture): string {
  const comparison = result?.optimization;
  if (result?.imagePath)
    return comparison?.complete && comparison.completed === comparison.total
      ? `${comparison.total}개 납품 순서 비교 완료 · 네이버 제공 자동차 옵션 중 ${result.distanceMeters === undefined ? '표시거리' : '주행거리'} 최단${result.legEvidence?.logicalPointMapping ? ' · 연속 동일 좌표는 지도 한 점, 원본 방문·0m 구간은 Excel에 유지' : ''}`
      : '이전 입력 순서 캡처 · 납품 순서 최단 미검증';
  return comparison
    ? `납품 순서 ${comparison.completed}/${comparison.total}개 확인 · 실패 ${comparison.failed.length}개${comparison.complete ? ' · 최종 캡처 저장 미완료' : ''}`
    : '';
}
export interface CaptureJob {
  id: string;
  status: string;
  courses: NaverCourse[];
  results: Record<string, CourseCapture>;
  center_code: string;
  updated_at: string;
}
const columns = 'id,status,courses,results,center_code,updated_at';
export async function enqueueCapture(
  center: string,
  courses: NaverCourse[],
  previousJob?: string,
) {
  const { data, error } = await supabase.rpc('naver_capture_enqueue', {
    p_center: center,
    p_courses: courses,
    p_previous_job: previousJob ?? null,
  });
  if (error) throw Error(error.message);
  return data as string;
}
export async function getCapture(id?: string, center?: string) {
  let q = supabase
    .from('naver_browser_jobs')
    .select(columns)
    .eq('kind', 'capture');
  if (id) q = q.eq('id', id);
  if (center) q = q.eq('center_code', center);
  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<CaptureJob>();
  if (error) throw Error('캡처 작업을 불러오지 못했습니다.');
  return data;
}
export async function captureImage(path: string) {
  const { data, error } = await supabase.storage
    .from('naver-course-captures')
    .download(path);
  if (error) throw Error('캡처 이미지를 불러오지 못했습니다.');
  return data;
}
export function saveFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function captureExports(
  job: CaptureJob,
  type: 'zip' | 'pdf' | 'xlsx',
  courseIds?: string[],
) {
  if (type === 'xlsx') {
    const { courseDistanceWorkbook } = await import('./naver-course-distance');
    const book = await courseDistanceWorkbook(job, courseIds);
    const buffer = await book.xlsx.writeBuffer();
    saveFile(
      new Blob([new Uint8Array(buffer)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      '네이버_최단경로_구간거리.xlsx',
    );
    return;
  }
  const ready = job.courses.filter((c) => job.results[c.id]?.imagePath);
  if (!ready.length) throw Error('출력할 캡처가 없습니다.');
  if (type === 'zip') {
    const { default: JSZip } = await import('jszip'),
      zip = new JSZip();
    for (const c of ready)
      zip.file(
        `${c.sourceRow}_${courseTitle(c).replace(/[\\/:*?"<>|]/g, '_')}.png`,
        await captureImage(job.results[c.id].imagePath!),
      );
    saveFile(
      await zip.generateAsync({ type: 'blob' }),
      '네이버_코스별_캡처.zip',
    );
  } else {
    const { PDFDocument } = await import('pdf-lib'),
      pdf = await PDFDocument.create();
    for (const c of ready) {
      const png = await pdf.embedPng(
        await (await captureImage(job.results[c.id].imagePath!)).arrayBuffer(),
      );
      const heading = document.createElement('canvas');
      heading.width = 1100;
      heading.height = 100;
      const ctx = heading.getContext('2d');
      if (!ctx) throw Error('PDF 제목 생성에 실패했습니다.');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 1100, 100);
      ctx.fillStyle = '#111';
      ctx.font = '600 28px Pretendard, sans-serif';
      ctx.fillText(
        `${(c.sourceRows ?? [c.sourceRow]).join(', ')}행 · ${courseTitle(c)}`,
        0,
        35,
        1100,
      );
      ctx.font = '20px Pretendard, sans-serif';
      ctx.fillText(
        `${job.results[c.id].optimization?.complete ? '납품 순서 비교 완료' : '입력 순서 · 순열 최단 미검증'} · ${job.results[c.id].routeLabel || '거리우선'} ${job.results[c.id].distanceText || ''} · ${new Date(job.results[c.id].measuredAt!).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`,
        0,
        75,
        1100,
      );
      const title = await pdf.embedPng(heading.toDataURL('image/png'));
      const page = pdf.addPage([595.28, 841.89]),
        scale = Math.min(555.28 / png.width, 741.89 / png.height);
      page.drawImage(title, { x: 20, y: 771.89, width: 555.28, height: 50 });
      page.drawImage(png, {
        x: (595.28 - png.width * scale) / 2,
        y: 841.89 - 80 - png.height * scale,
        width: png.width * scale,
        height: png.height * scale,
      });
    }
    saveFile(
      new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' }),
      '네이버_코스별_캡처.pdf',
    );
  }
}
