import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  taskState,
  taskStateLabels,
  taskPeriod,
  taskEnd,
  calendarDates,
  calendarSegments,
} from '../../domain/portal-calendar';
import { koreaDate, statusLabels } from '../../domain/operations';
import type {
  PortalTask,
  PortalIncident,
  ParticipantSubject,
  PortalSelection,
} from '../../domain/portal-types';
import { portalStamp } from '../../domain/portal-types';
export const cadenceLabels: Record<string, string> = {
  none: '필요할 때마다',
  daily: '일일업무',
  weekly: '주간업무',
  monthly: '월간업무',
};
export function subjectLabel(
  subject: ParticipantSubject | undefined,
  centerName: (code: string) => string,
) {
  if (!subject) return '미지정';
  if (subject.kind === 'center') return centerName(subject.center_code || '');
  if (subject.kind === 'role') return subject.name;
  const properties = [
    ...(subject.centers ?? []).map(centerName),
    ...(subject.role === 'admin' ? ['배송팀'] : []),
  ];
  return (
    subject.name + (properties.length ? ' · ' + properties.join(', ') : '')
  );
}
export function PortalTaskRow({
  row,
  type = 'task',
  extra = '',
  centerName,
  onChoose,
  hq = false,
  style,
  className = '',
  title,
}: {
  row: PortalTask | PortalIncident;
  type?: 'task' | 'incident';
  extra?: string;
  centerName: (code: string) => string;
  onChoose: (selection: PortalSelection) => void;
  hq?: boolean;
  style?: CSSProperties;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={'task-row ' + className}
      style={style}
      title={title}
      data-task-state={
        type === 'task' ? taskState(row as PortalTask) : undefined
      }
      onClick={() =>
        onChoose(
          type === 'task'
            ? { type: 'task', row: row as PortalTask }
            : { type: 'incident', row: row as PortalIncident },
        )
      }
    >
      <span className="task-row-copy">
        {type === 'incident' || hq ? (
          <span className="center-property">{centerName(row.center_code)}</span>
        ) : null}
        {hq ? (
          <span className="record-property">
            {type === 'incident' ? '특이사항' : '업무'}
          </span>
        ) : null}
        <strong className="task-row-name">
          {row.title.replaceAll('HQ', '배송팀')}
        </strong>
        <small>{extra.replaceAll('HQ', '배송팀')}</small>
      </span>
      <span
        className={
          'badge status-' +
          (type === 'task'
            ? taskState(row as PortalTask)
            : 'incident-' + (row.status === 'resolved' ? 'resolved' : 'open'))
        }
      >
        {type === 'task'
          ? taskStateLabels[taskState(row as PortalTask)]
          : row.status === 'resolved'
            ? '처리완료'
            : (statusLabels[row.status] ?? row.status)}
      </span>
    </button>
  );
}
function DailyPopup({
  tasks,
  date,
  participants,
  centerName,
  onChoose,
}: {
  tasks: PortalTask[];
  date: string;
  participants: ParticipantSubject[];
  centerName: (code: string) => string;
  onChoose: (selection: PortalSelection) => void;
}) {
  const [id] = useState(() => 'daily-' + crypto.randomUUID()),
    [open, setOpen] = useState(false),
    [position, setPosition] = useState<CSSProperties>({}),
    trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="calendar-daily-button"
        popoverTarget={id}
        aria-label={'일일 업무 ' + tasks.length + '건'}
        aria-expanded={open}
        aria-controls={id}
        title="날짜별 일일 업무 목록 펼치기"
      >
        일일 업무 {tasks.length}건
      </button>
      <div
        ref={popup}
        id={id}
        className="calendar-daily-dropdown"
        popover="auto"
        aria-label={date + ' 일일 업무'}
        style={position}
        onBeforeToggle={(event) => {
          if (
            (event.nativeEvent as ToggleEvent).newState !== 'open' ||
            !trigger.current
          )
            return;
          const rect = trigger.current.getBoundingClientRect(),
            width = Math.min(360, innerWidth - 24),
            height = Math.min(360, innerHeight - 24);
          setPosition({
            width,
            maxHeight: height,
            left: Math.max(12, Math.min(rect.left, innerWidth - width - 12)),
            top: Math.max(
              12,
              Math.min(rect.bottom + 6, innerHeight - height - 12),
            ),
          });
        }}
        onToggle={(event) =>
          setOpen((event.nativeEvent as ToggleEvent).newState === 'open')
        }
      >
        <strong>{date} · 일일 업무</strong>
        {tasks.map((task) => {
          const handler =
            participants.find((s) => s.id === task.handler_subject_id) ??
            participants.find((s) => s.user_id === task.owner_id);
          return (
            <PortalTaskRow
              key={task.id}
              row={task}
              extra={[
                centerName(task.center_code),
                cadenceLabels[task.template_snapshot?.spec?.ui_cadence || ''] ??
                  '일회성 업무',
                handler
                  ? '담당 ' + subjectLabel(handler, centerName)
                  : '담당 미지정',
              ].join(' · ')}
              centerName={centerName}
              onChoose={(selection) => {
                popup.current?.hidePopover();
                onChoose(selection);
              }}
            />
          );
        })}
      </div>
    </>
  );
}
export function PortalCalendar({
  tasks,
  date,
  unit,
  participants,
  centerName,
  onChoose,
}: {
  tasks: PortalTask[];
  date: string;
  unit: string;
  participants: ParticipantSubject[];
  centerName: (code: string) => string;
  onChoose: (selection: PortalSelection) => void;
}) {
  const daily =
      unit === 'month' ? tasks.filter((t) => taskEnd(t) === t.work_date) : [],
    periodTasks =
      unit === 'month'
        ? tasks.filter((t) => taskEnd(t) !== t.work_date)
        : tasks,
    dates = calendarDates(date, unit),
    width = unit === 'day' ? 1 : 7,
    weeks = Array.from(
      { length: Math.ceil(dates.length / width) },
      (_, index) => dates.slice(index * width, (index + 1) * width),
    );
  return (
    <div
      className={`task-calendar calendar-spans calendar-${unit}${tasks.length ? '' : ' is-empty'}`}
      role="region"
      aria-label="업무 달력 · 좁은 화면에서는 좌우로 이동해 날짜를 확인하세요."
      tabIndex={0}
    >
      {weeks.map((days) => (
        <div
          key={days[0]}
          className="calendar-span-week"
          style={{ '--days': days.length } as CSSProperties}
        >
          {days.map((day, i) => (
            <section
              key={day}
              className={
                'calendar-cell' + (day === koreaDate() ? ' calendar-today' : '')
              }
              style={{ gridColumn: i + 1 }}
            >
              <h4>
                {day.slice(5)} ·{' '}
                {'일월화수목금토'[new Date(day + 'T00:00:00Z').getUTCDay()]}
              </h4>
              {unit === 'month' && daily.some((t) => t.work_date === day) ? (
                <DailyPopup
                  tasks={daily.filter((t) => t.work_date === day)}
                  date={day}
                  participants={participants}
                  centerName={centerName}
                  onChoose={onChoose}
                />
              ) : null}
            </section>
          ))}
          <div className="calendar-bars">
            {calendarSegments(periodTasks, days).map(
              ({ task, start, end, lane, continuesBefore, continuesAfter }) => (
                <PortalTaskRow
                  key={task.id}
                  row={task}
                  centerName={centerName}
                  onChoose={onChoose}
                  extra={taskPeriod(task)
                    .replace(/\d{4}-(\d{2})-(\d{2})/g, '$1.$2')
                    .replace(' ~ ', '–')}
                  className={
                    'calendar-task-bar' +
                    (continuesBefore ? ' continues-before' : '') +
                    (continuesAfter ? ' continues-after' : '')
                  }
                  style={{
                    gridColumn: `${start + 1} / ${end + 2}`,
                    gridRow: lane + 1,
                  }}
                  title={task.title + ' · ' + taskPeriod(task)}
                />
              ),
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
export function PortalTaskWithChildren({
  task,
  incidents,
  centerName,
  onChoose,
}: {
  task: PortalTask;
  incidents: PortalIncident[];
  centerName: (code: string) => string;
  onChoose: (selection: PortalSelection) => void;
}) {
  const children = incidents.filter((i) => i.task_id === task.id);
  return (
    <>
      <PortalTaskRow
        row={task}
        extra={
          taskPeriod(task) +
          ' · ' +
          (cadenceLabels[task.template_snapshot?.spec?.ui_cadence || ''] ??
            '업무')
        }
        centerName={centerName}
        onChoose={onChoose}
      />
      {children.length ? (
        <div className="incident-children">
          {children.map((row) => (
            <PortalTaskRow
              key={row.id}
              row={row}
              type="incident"
              centerName={centerName}
              onChoose={onChoose}
              extra={'↳ 특이사항 · ' + portalStamp(row.created_at)}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}
