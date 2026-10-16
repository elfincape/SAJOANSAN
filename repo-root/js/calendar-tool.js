import { Calendar } from 'fullcalendar/all';
import classicTheme from 'fullcalendar/themes/classic';
import koreanLocale from 'fullcalendar/locales/ko';
import 'fullcalendar/skeleton.css';
import 'fullcalendar/themes/classic/theme.css';
import 'fullcalendar/themes/classic/palette.css';
import { requireRole } from './auth.js';
import { withCenterParam } from './center.js';

const element = (id) => document.getElementById(id);
let calendar;
let storageKey;
let selectedEvent = null;

function message(text, error = false) {
  element('status').textContent = text;
  element('status').classList.toggle('error', error);
}

function dateInput(date, allDay = true) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString();
  return local.slice(0, allDay ? 10 : 16);
}

function shiftDay(value, days) {
  const date = new Date(value + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return dateInput(date);
}

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(calendar.getEvents().map((event) => ({
      id: event.id, title: event.title, start: event.startStr, end: event.endStr || undefined,
      allDay: event.allDay, extendedProps: { memo: event.extendedProps.memo || '' },
    }))));
    message(`일정 ${calendar.getEvents().length}개 · 이 브라우저에 저장됨`);
    return true;
  } catch {
    message('브라우저에 저장하지 못했습니다. 저장 공간과 브라우저 설정을 확인하세요. 현재 변경 내용은 창을 닫으면 사라집니다.', true);
    return false;
  }
}

function openForm({ event = null, start = new Date(), end = null, allDay = true } = {}) {
  selectedEvent = event;
  element('event-form').reset();
  element('form-error').textContent = '';
  element('dialog-title').textContent = event ? '일정 수정' : '일정 추가';
  element('delete-event').hidden = !event;
  const isAllDay = event ? event.allDay : allDay;
  const startDate = event ? event.start : start;
  const endDate = event ? event.end : end;
  element('event-title').value = event?.title || '';
  element('event-memo').value = event?.extendedProps.memo || '';
  element('event-all-day').checked = isAllDay;
  setInputTypes(isAllDay);
  element('event-start').value = dateInput(startDate, isAllDay);
  element('event-end').value = isAllDay
    ? endDate ? shiftDay(dateInput(endDate), -1) : dateInput(startDate)
    : dateInput(endDate || new Date(startDate.getTime() + 3600000), false);
  element('event-dialog').showModal();
  element('event-title').focus();
}

function setInputTypes(allDay) {
  for (const id of ['event-start', 'event-end']) {
    const input = element(id);
    const value = input.value;
    input.type = allDay ? 'date' : 'datetime-local';
    if (value) input.value = allDay ? value.slice(0, 10) : value.length === 10 ? value + 'T09:00' : value;
  }
  element('event-end').previousElementSibling.querySelector('span').textContent = allDay ? '(포함)' : '';
}

async function init() {
  const profile = await requireRole('editor');
  if (!profile) return;
  element('back-link').href = withCenterParam('/admin/');
  element('user-badge').textContent = profile.display_name || profile.email || '';
  storageKey = `sajoansan:calendar:${profile.id}`;
  let events = [];
  let loadError = false;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    if (!Array.isArray(saved)) throw new Error('Invalid calendar');
    events = saved.filter((event) => event && typeof event.title === 'string' && typeof event.start === 'string').map((event) => ({
      id: String(event.id || crypto.randomUUID()), title: event.title.slice(0, 160), start: event.start,
      end: typeof event.end === 'string' ? event.end : undefined, allDay: Boolean(event.allDay),
      extendedProps: { memo: typeof event.extendedProps?.memo === 'string' ? event.extendedProps.memo.slice(0, 5000) : '' },
    }));
  } catch { loadError = true; }
  calendar = new Calendar(element('calendar'), {
    plugins: [classicTheme], locale: koreanLocale, initialView: 'dayGridMonth',
    headerToolbar: { start: 'prev,next today', center: 'title', end: 'dayGridMonth,timeGridWeek,timeGridDay' },
    buttonText: { today: '오늘', month: '월', week: '주', day: '일' },
    firstDay: 1, height: 'auto', editable: true, selectable: true, dayMaxEvents: true,
    nowIndicator: true, events,
    dateClick: (info) => openForm({ start: info.date, allDay: info.allDay }),
    select: (info) => { openForm({ start: info.start, end: info.end, allDay: info.allDay }); calendar.unselect(); },
    eventClick: (info) => { info.jsEvent.preventDefault(); openForm({ event: info.event }); },
    eventDrop: (info) => { if (!persist()) info.revert(); },
    eventResize: (info) => { if (!persist()) info.revert(); },
  });
  calendar.render();
  element('workspace').disabled = false;
  element('add-event').onclick = () => openForm();
  element('cancel-event').onclick = () => element('event-dialog').close();
  element('event-all-day').onchange = () => setInputTypes(element('event-all-day').checked);
  element('event-form').onsubmit = (submission) => {
    submission.preventDefault();
    const title = element('event-title').value.trim();
    const allDay = element('event-all-day').checked;
    const start = element('event-start').value;
    const last = element('event-end').value;
    if (!title || !start || !last || (allDay ? last < start : last <= start)) {
      element('form-error').textContent = '제목과 날짜를 확인하세요. 종료는 시작 이후여야 합니다 (종일 일정은 같은 날 가능).';
      return;
    }
    const data = { id: selectedEvent?.id || crypto.randomUUID(), title, start,
      end: allDay ? shiftDay(last, 1) : last, allDay, extendedProps: { memo: element('event-memo').value } };
    const previous = selectedEvent?.toPlainObject();
    selectedEvent?.remove();
    const added = calendar.addEvent(data);
    if (!persist()) {
      added.remove();
      if (previous) selectedEvent = calendar.addEvent(previous);
      element('form-error').textContent = '저장에 실패했습니다. 입력 내용을 유지했습니다. 다시 저장해 주세요.';
      return;
    }
    element('event-dialog').close();
  };
  element('delete-event').onclick = () => {
    if (!selectedEvent || !confirm('이 일정을 삭제할까요?')) return;
    const previous = selectedEvent.toPlainObject();
    selectedEvent.remove();
    if (!persist()) { selectedEvent = calendar.addEvent(previous); return; }
    element('event-dialog').close();
  };
  message(loadError ? '저장된 일정을 읽지 못했습니다. 브라우저 저장 설정을 확인하세요. 새 일정을 저장하면 기존 브라우저 데이터가 교체됩니다.' : `일정 ${events.length}개 · 날짜를 선택해 시작하세요.`, loadError);
}

init().catch((error) => message('일정 도구 초기화 실패: ' + error.message, true));
