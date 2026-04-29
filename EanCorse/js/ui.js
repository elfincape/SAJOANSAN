// 공통 UI 헬퍼 (토스트, 모달, 포맷터)
// =============================================================================
// DOM 외 의존성 없음. 다크모드 기본, Tailwind 클래스를 활용.
// 토스트/모달 컨테이너는 처음 호출 시 자동 생성.
// =============================================================================

// ----- 토스트 ----------------------------------------------------------------

function ensureToastContainer() {
  let el = document.getElementById('toast-container');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-container';
    el.className = 'fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none';
    document.body.appendChild(el);
  }
  return el;
}

const TOAST_STYLE = {
  info:    'bg-zinc-800 border-zinc-600 text-zinc-100',
  success: 'bg-emerald-900/90 border-emerald-600 text-emerald-50',
  error:   'bg-red-900/90 border-red-600 text-red-50',
  warn:    'bg-amber-900/90 border-amber-600 text-amber-50'
};

export function toast(msg, type = 'info', duration = 2800) {
  const root = ensureToastContainer();
  const node = document.createElement('div');
  const style = TOAST_STYLE[type] || TOAST_STYLE.info;
  node.className =
    `pointer-events-auto px-4 py-2.5 rounded-md border shadow-lg text-sm ` +
    `transition-all duration-200 opacity-0 translate-y-[-4px] ${style}`;
  node.textContent = msg;
  root.appendChild(node);

  // 등장 애니메이션
  requestAnimationFrame(() => {
    node.classList.remove('opacity-0', 'translate-y-[-4px]');
  });

  // 자동 제거
  setTimeout(() => {
    node.classList.add('opacity-0');
    setTimeout(() => node.remove(), 220);
  }, duration);
}

// ----- 모달 ------------------------------------------------------------------

function ensureModalRoot() {
  let el = document.getElementById('modal-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'modal-root';
    document.body.appendChild(el);
  }
  return el;
}

let _activeModal = null;

// content: HTML 문자열 또는 DOM 노드
// options: { width: 'sm'|'md'|'lg'|'xl', dismissable: true }
export function openModal(content, options = {}) {
  closeModal(); // 이전 모달 정리

  const { width = 'md', dismissable = true } = options;
  const widthClass = {
    sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-2xl'
  }[width] || 'max-w-md';

  const root = ensureModalRoot();
  const overlay = document.createElement('div');
  overlay.className =
    'fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm ' +
    'opacity-0 transition-opacity duration-150';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');

  const panel = document.createElement('div');
  panel.className =
    `w-full ${widthClass} mx-4 rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-100 ` +
    `shadow-2xl scale-95 transition-transform duration-150`;
  panel.addEventListener('click', (e) => e.stopPropagation());

  if (typeof content === 'string') {
    panel.innerHTML = content;
  } else if (content instanceof Node) {
    panel.appendChild(content);
  }

  overlay.appendChild(panel);
  root.appendChild(overlay);

  // 등장 애니메이션
  requestAnimationFrame(() => {
    overlay.classList.remove('opacity-0');
    panel.classList.remove('scale-95');
  });

  if (dismissable) {
    overlay.addEventListener('click', () => closeModal());
    const escHandler = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', escHandler);
    overlay._escHandler = escHandler;
  }

  _activeModal = overlay;
  return { overlay, panel };
}

export function closeModal() {
  if (!_activeModal) return;
  const m = _activeModal;
  _activeModal = null;

  if (m._escHandler) {
    document.removeEventListener('keydown', m._escHandler);
  }
  m.classList.add('opacity-0');
  setTimeout(() => m.remove(), 150);
}

// 확인 모달 (브라우저 confirm 대체)
// options: { okText, cancelText, okOnly, danger }
export function confirmDialog(msg, options = {}) {
  const {
    okText     = '확인',
    cancelText = '취소',
    okOnly     = false,
    danger     = false
  } = options;

  return new Promise((resolve) => {
    const panel = document.createElement('div');
    panel.className = 'p-5';

    const okClass = danger
      ? 'bg-red-600 hover:bg-red-500 text-white'
      : 'bg-emerald-600 hover:bg-emerald-500 text-white';

    panel.innerHTML = `
      <div class="text-sm whitespace-pre-line leading-relaxed text-zinc-100 mb-5">
        ${escapeHtml(msg)}
      </div>
      <div class="flex justify-end gap-2">
        ${okOnly ? '' : `
          <button data-act="cancel"
            class="px-3 py-1.5 rounded-md text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-100">
            ${escapeHtml(cancelText)}
          </button>
        `}
        <button data-act="ok"
          class="px-3 py-1.5 rounded-md text-sm ${okClass}">
          ${escapeHtml(okText)}
        </button>
      </div>
    `;

    const { overlay } = openModal(panel, { width: 'sm', dismissable: !okOnly });

    panel.querySelector('[data-act="ok"]').addEventListener('click', () => {
      closeModal();
      resolve(true);
    });
    const cancelBtn = panel.querySelector('[data-act="cancel"]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => {
        closeModal();
        resolve(false);
      });
    }

    // 오버레이 클릭으로 닫혔을 때도 false로 처리
    overlay.addEventListener('click', () => resolve(false), { once: true });
  });
}

// ----- 포맷터 ----------------------------------------------------------------

// 휴대전화/일반전화 표시 포맷
//   01012345678    → 010-1234-5678
//   0212345678     → 02-1234-5678
//   025551234      → 02-555-1234
//   0311234567     → 031-123-4567
//   0311234567X    → 그대로 (변환 실패 시 원문)
export function formatPhone(str) {
  if (!str) return '';
  const digits = String(str).replace(/\D/g, '');

  // 서울 02
  if (digits.startsWith('02')) {
    if (digits.length === 9)  return `02-${digits.slice(2,5)}-${digits.slice(5)}`;
    if (digits.length === 10) return `02-${digits.slice(2,6)}-${digits.slice(6)}`;
  }
  // 휴대전화 / 기타 지역번호 (3자리 시외)
  if (digits.length === 10) {
    return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
  }
  // 8자리(대표번호 1588 등)
  if (digits.length === 8) {
    return `${digits.slice(0,4)}-${digits.slice(4)}`;
  }
  return str;
}

// ----- 내부 유틸 -------------------------------------------------------------

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
