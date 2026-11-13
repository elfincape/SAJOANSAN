import type { PortalEvent, PortalTask } from '../../domain/portal-types';
import { portalStamp } from '../../domain/portal-types';
import { statusLabels } from '../../domain/operations';
import { taskPeriod } from '../../domain/portal-calendar';
import { MentionText } from './PortalMentions';

const display = (value: unknown) => value === true ? '예' : value === false ? '아니요' :
  value === '' ? '빈 값' : value == null ? '미등록' : typeof value === 'object' ? JSON.stringify(value) : String(value);

export function PortalEventSnapshot({ event }: { event: PortalEvent }) {
  const row = event.after_value as Partial<PortalTask> | undefined;
  if (!row || typeof row.title !== 'string') return null;
  const spec = row.template_snapshot?.spec;
  const inputs = row.inputs ?? {};
  const fields = (Array.isArray(spec?.fields) ? spec.fields : [])
    .filter(field => Object.hasOwn(inputs, field.key));
  return (
    <details className="history">
      <summary style={{ color: 'var(--theme-text)' }}>{event.action === 'created' ? '등록 당시 업무' : '처리 당시 업무·근거'}</summary>
      <p><MentionText>{row.title}</MentionText> · 당시 상태 <MentionText>{statusLabels[row.status ?? ''] ?? row.status ?? '기록 없음'}</MentionText></p>
      {typeof row.work_date === 'string' ? <p>업무 회차 · <MentionText>{taskPeriod({ work_date: row.work_date, work_end_date: row.work_end_date })}</MentionText></p> : null}
      {row.due_at ? <p>당시 마감 · <MentionText>{portalStamp(row.due_at)}</MentionText></p> : null}
      {row.completed_at ? <p>당시 완료 시각 · <MentionText>{portalStamp(row.completed_at)}</MentionText></p> : null}
      {spec?.description ? <p><MentionText>{spec.description}</MentionText></p> : null}
      {spec?.completion_condition ? <p>당시 완료 조건 · <MentionText>{spec.completion_condition}</MentionText></p> : null}
      {Object.hasOwn(inputs, 'work_note') ? <p><MentionText>{display(inputs.work_note)}</MentionText></p> : null}
      {fields.length ? <dl>{fields.map(field => <div key={field.key}><dt><MentionText>{field.label}</MentionText></dt><dd><MentionText>{display(inputs[field.key])}</MentionText></dd></div>)}</dl> : null}
      {Array.isArray(spec?.steps) ? spec.steps.filter(step => Object.hasOwn(inputs.steps ?? {}, step.key)).map(step => <p key={step.key}><MentionText>{step.label}</MentionText> · <MentionText>{statusLabels[inputs.steps![step.key]] ?? inputs.steps![step.key]}</MentionText></p>) : null}
    </details>
  );
}
