import type { PortalTask } from './portal-types';

const missing = '확인 필요';
function field(value: unknown) {
  return typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 500) : '';
}
function dateLabel(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return missing;
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) return missing;
  return `${value.slice(5, 7)}/${value.slice(8, 10)}일 ${'일월화수목금토'[date.getUTCDay()]}요일`;
}
function timeLabel(value: unknown) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return missing;
  const hour = Number(value.slice(0, 2));
  return `${hour < 12 ? '오전' : '오후'} ${String(hour % 12 || 12).padStart(2, '0')}:${value.slice(3)}`;
}
export function yangsanDriverGuidance(task: Pick<PortalTask, 'center_code' | 'status' | 'deleted_at' | 'inputs'>): string | null {
  const marker = task.inputs?.yangsan_dispatch;
  if (task.center_code !== 'yangsan' || task.status !== 'completed' || task.deleted_at || !marker || typeof marker !== 'object' || Array.isArray(marker)) return null;
  const details = marker as Record<string, unknown>;
  const contact = field(details.contact);
  return `사장님 상/하차지 정보 공유드립니다

상차지: 경남 양산시 산막공단로133 사조오양 양산공장
하차지: ${field(details.unloadingAddress) || missing}

★상차 : ${dateLabel(details.loadingDate)} ${timeLabel(details.loadingTime)} 상차
★하차 : ${dateLabel(details.unloadingDate)} ${timeLabel(details.unloadingTime)} 하차${contact ? '\n담당자 : ' + contact : ''}

인수증 사진찍어서 문자로 보내주세요
파레트전표도 같이 보내주세요

*반바지및 슬리퍼착용금지*`;
}
