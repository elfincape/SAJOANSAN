import { requireRole } from './auth.js';
import { CENTERS, decorateCenterLinks, getRequiredCenter, requireSelectedCenter } from './center.js';
import { DOCUMENT_TYPES } from './driver-documents.js';
import { validateAssignments } from './pdf-image-assignment.js';
import { oneDriveDocuments } from './onedrive-api.js';
import { supabase } from './supabase.js';
import { fetchAllRows } from './unassigned-delivery-points.js';

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_PAGES = 100;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const $ = id => document.getElementById(id);
const state = { pdf: null, cards: [], drivers: [], companies: [], generation: 0, saving: false, loading: false };

function option(value, label) {
  const node = document.createElement('option'); node.value = value; node.textContent = label; return node;
}
function fillSelect(select, items, placeholder, selected = '') {
  select.replaceChildren(option('', placeholder), ...items.map(item => option(item.id, item.name)));
  select.value = selected;
}
function companiesIn(center) { return state.companies.filter(row => row.center_code === center); }
function driversIn(center) { return state.drivers.filter(row => row.center_code === center); }
function driverFor(id) { return state.drivers.find(row => row.id === id); }
function setCenterFields(centerSelect, driverSelect, companySelect, center, driver = '', company = '') {
  centerSelect.value = center;
  fillSelect(driverSelect, driversIn(center), '기사 선택', driver);
  fillSelect(companySelect, companiesIn(center), '운수사 선택', company);
}
function onDriverChanged(centerSelect, driverSelect, companySelect, expiryInput) {
  const driver = driverFor(driverSelect.value);
  if (!driver) return;
  setCenterFields(centerSelect, driverSelect, companySelect, driver.center_code, driver.id, driver.company_id || '');
  expiryInput.value = driver.health_certificate_expires_on || '';
}
function makeFields(container, { center, driver = '', company = '', expiry = '' } = {}) {
  const centerSelect = document.createElement('select'); centerSelect.className = 'app-select';
  centerSelect.append(...CENTERS.map(item => option(item.code, item.name)));
  const driverSelect = document.createElement('select'); driverSelect.className = 'app-select';
  const companySelect = document.createElement('select'); companySelect.className = 'app-select';
  const expiryInput = document.createElement('input'); expiryInput.type = 'date'; expiryInput.className = 'app-input'; expiryInput.value = expiry;
  setCenterFields(centerSelect, driverSelect, companySelect, center, driver, company);
  const fields = [['센터', centerSelect], ['기사', driverSelect], ['운수사', companySelect], ['보건증 만료일', expiryInput]];
  for (const [name, input] of fields) {
    const label = document.createElement('label'); label.className = 'text-xs space-y-1';
    const text = document.createElement('span'); text.textContent = name; label.append(text, input); container.append(label);
  }
  centerSelect.addEventListener('change', () => setCenterFields(centerSelect, driverSelect, companySelect, centerSelect.value));
  driverSelect.addEventListener('change', () => onDriverChanged(centerSelect, driverSelect, companySelect, expiryInput));
  return { centerSelect, driverSelect, companySelect, expiryInput };
}

function getCardAssignment(card) {
  return { pageNumber: card.pageNumber, selected: card.checkbox.checked, driverId: card.fields.driverSelect.value,
    center: card.fields.centerSelect.value, companyId: card.fields.companySelect.value,
    kind: card.kindSelect.value, expiry: card.fields.expiryInput.value };
}

async function renderPage(pdf, pageNumber, maxWidth) {
  const page = await pdf.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(maxWidth / base.width, 2400 / base.height);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(viewport.width)); canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, background: 'white' }).promise;
  page.cleanup();
  return canvas;
}
function jpegBlob(canvas, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('이미지 변환에 실패했습니다.')), 'image/jpeg', quality));
}
async function imageForPage(pdf, pageNumber) {
  let width = 1800;
  for (let attempt = 0; attempt < 4; attempt++) {
    const canvas = await renderPage(pdf, pageNumber, width);
    const blob = await jpegBlob(canvas, attempt ? 0.78 : 0.86);
    canvas.width = canvas.height = 0;
    if (blob.size <= MAX_IMAGE_BYTES) return new File([blob], `pdf-page-${pageNumber}.jpg`, { type: 'image/jpeg' });
    width = Math.round(width * 0.75);
  }
  throw new Error(`${pageNumber}페이지를 10MB 이하 이미지로 변환하지 못했습니다.`);
}

function createCard(pageNumber) {
  const root = document.createElement('article'); root.className = 'rounded-lg border border-zinc-700 bg-zinc-800/40 p-3 space-y-3';
  const title = document.createElement('label'); title.className = 'flex items-center gap-2 font-semibold';
  const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true;
  title.append(checkbox, document.createTextNode(`${pageNumber}페이지`));
  const preview = document.createElement('div'); preview.className = 'h-48 bg-zinc-950 rounded flex items-center justify-center overflow-hidden';
  preview.textContent = '미리보기 생성 중…';
  const controls = document.createElement('div'); controls.className = 'grid grid-cols-2 gap-2';
  const fields = makeFields(controls, {
    center: $('default-center').value, driver: $('default-driver').value,
    company: $('default-company').value, expiry: $('default-expiry').value
  });
  const kindLabel = document.createElement('label'); kindLabel.className = 'block text-xs space-y-1';
  const kindText = document.createElement('span'); kindText.textContent = '서류 종류';
  const kindSelect = document.createElement('select'); kindSelect.className = 'app-select';
  kindSelect.append(option('', '서류 종류 선택'), ...DOCUMENT_TYPES.map(([kind, label]) => option(kind, label)));
  kindLabel.append(kindText, kindSelect);
  const download = document.createElement('button'); download.type = 'button'; download.className = 'btn btn-ghost text-xs';
  download.textContent = 'JPG 다운로드';
  const note = document.createElement('p'); note.className = 'text-xs text-zinc-400'; note.setAttribute('role', 'status');
  download.addEventListener('click', async () => {
    if (state.saving || !state.pdf) return;
    download.disabled = true; note.textContent = 'JPG 변환 중…';
    try {
      const file = await imageForPage(state.pdf, pageNumber);
      const url = URL.createObjectURL(file);
      const link = document.createElement('a'); link.href = url; link.download = file.name;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      note.textContent = 'JPG 다운로드 준비 완료';
    } catch (error) { note.textContent = error.message; }
    finally { download.disabled = false; }
  });
  root.append(title, preview, controls, kindLabel, download, note); $('pages').append(root);
  return { root, pageNumber, checkbox, preview, fields, kindSelect, note };
}

async function loadPdf(file) {
  if (!file) return;
  if (state.saving || state.loading) { $('load-status').textContent = '현재 작업이 끝난 뒤 PDF를 바꿔 주세요.'; return; }
  if (file.type !== 'application/pdf' && !/\.pdf$/i.test(file.name)) { $('load-status').textContent = 'PDF 파일을 선택해 주세요.'; return; }
  if (!file.size || file.size > MAX_PDF_BYTES) { $('load-status').textContent = 'PDF는 50MB 이하만 선택할 수 있습니다.'; return; }
  state.loading = true;
  $('pdf-file').disabled = true;
  const generation = ++state.generation;
  $('pages').replaceChildren(); $('assignment').hidden = true; $('save-bar').hidden = true;
  state.cards = [];
  $('load-status').textContent = 'PDF를 읽는 중…';
  try {
    if (state.pdf) { await state.pdf.destroy(); state.pdf = null; }
    const pdfjs = await import(PDFJS_URL);
    pdfjs.GlobalWorkerOptions.workerSrc = WORKER_URL;
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    if (generation !== state.generation) { await pdf.destroy(); return; }
    if (pdf.numPages > MAX_PAGES) { await pdf.destroy(); throw new Error('PDF는 100페이지 이하만 처리할 수 있습니다.'); }
    state.pdf = pdf; $('assignment').hidden = false; $('save-bar').hidden = false;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (generation !== state.generation) return;
      const card = createCard(pageNumber); state.cards.push(card);
      try {
        const canvas = await renderPage(pdf, pageNumber, 190);
        card.preview.replaceChildren(canvas); canvas.className = 'max-h-full max-w-full object-contain';
      } catch (error) { card.preview.textContent = '미리보기 실패: ' + error.message; card.checkbox.checked = false; }
      $('load-status').textContent = `${pageNumber}/${pdf.numPages}페이지 미리보기 생성됨`;
    }
  } catch (error) { $('load-status').textContent = 'PDF를 읽지 못했습니다: ' + error.message; }
  finally { state.loading = false; $('pdf-file').disabled = false; }
}

async function saveSelected() {
  if (state.saving || !state.pdf) return;
  let selected;
  try {
    selected = validateAssignments(state.cards.map(getCardAssignment), state.drivers, state.companies);
  } catch (error) { $('save-status').textContent = error.message; return; }
  state.saving = true; $('save-selected').disabled = true; $('pdf-file').disabled = true;
  let saved = 0;
  try {
    const connection = await oneDriveDocuments.status();
    if (!connection.connected) throw new Error('OneDrive 연결이 필요합니다. 기사 관리에서 관리자에게 연결을 요청해 주세요.');
    const existing = new Map();
    for (const id of new Set(selected.map(item => item.driverId))) existing.set(id, await oneDriveDocuments.list(id));
    const replacements = selected.filter(item => existing.get(item.driverId)?.some(doc => doc.document_type === item.kind));
    if (replacements.length && !window.confirm(`기존 서류 ${replacements.length}장을 새 이미지로 교체합니다. 계속할까요?`)) return;
    for (const item of selected) {
      const card = state.cards[item.pageNumber - 1];
      card.note.textContent = '이미지 변환 중…';
      try {
        const file = await imageForPage(state.pdf, item.pageNumber);
        card.note.textContent = 'OneDrive에 등록 중…';
        await oneDriveDocuments.upload({ driverId: item.driverId, kind: item.kind, file,
          companyId: item.companyId, expiresOn: item.kind === 'health_certificate' ? item.expiry : null,
          requestId: crypto.randomUUID() });
        saved++; card.note.textContent = '등록 완료'; card.checkbox.checked = false;
      } catch (error) { card.note.textContent = '등록 실패: ' + error.message; }
      $('save-status').textContent = `${saved}/${selected.length}장 등록 완료`;
    }
  } catch (error) { $('save-status').textContent = error.message; }
  finally { state.saving = false; $('save-selected').disabled = false; $('pdf-file').disabled = false; }
}

async function main() {
  const profile = await requireRole('editor'); if (!profile) return;
  $('user-badge').textContent = `${profile.display_name || profile.email || ''} (${profile.role})`;
  await requireSelectedCenter(); decorateCenterLinks(document);
  try {
    [state.drivers, state.companies] = await Promise.all([
      fetchAllRows(() => supabase.from('drivers').select('id,name,center_code,company_id,health_certificate_expires_on').order('name')),
      fetchAllRows(() => supabase.from('companies').select('id,name,center_code').order('name'))
    ]);
  } catch (error) { $('load-status').textContent = '기사/운수사 목록을 불러오지 못했습니다: ' + error.message; return; }
  const defaultFields = makeFields(document.createDocumentFragment(), { center: getRequiredCenter().code });
  for (const [id, input] of [['default-center', defaultFields.centerSelect], ['default-driver', defaultFields.driverSelect],
    ['default-company', defaultFields.companySelect], ['default-expiry', defaultFields.expiryInput]]) {
    const old = $(id); input.id = id; old.replaceWith(input);
  }
  $('pdf-file').addEventListener('change', event => {
    const file = event.target.files?.[0]; event.target.value = '';
    loadPdf(file);
  });
  const dropzone = $('pdf-dropzone');
  let dragDepth = 0;
  const highlight = active => {
    dropzone.classList.toggle('border-emerald-400', active);
    dropzone.classList.toggle('bg-emerald-900/20', active);
  };
  dropzone.addEventListener('dragenter', event => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault(); dragDepth++; highlight(true);
  });
  dropzone.addEventListener('dragover', event => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
  });
  dropzone.addEventListener('dragleave', event => {
    if (!event.dataTransfer?.types.includes('Files')) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) highlight(false);
  });
  dropzone.addEventListener('drop', event => {
    event.preventDefault(); dragDepth = 0; highlight(false);
    const files = event.dataTransfer?.files;
    if (files?.length !== 1) { $('load-status').textContent = 'PDF 파일을 한 개씩 놓아 주세요.'; return; }
    loadPdf(files[0]);
  });
  window.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
  window.addEventListener('drop', event => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); });
  $('apply-defaults').addEventListener('click', () => {
    for (const card of state.cards) setCenterFields(card.fields.centerSelect, card.fields.driverSelect,
      card.fields.companySelect, $('default-center').value, $('default-driver').value, $('default-company').value);
    for (const card of state.cards) card.fields.expiryInput.value = $('default-expiry').value;
  });
  $('save-selected').addEventListener('click', saveSelected);
  try { const connection = await oneDriveDocuments.status(); $('connection-status').textContent = connection.connected ? 'OneDrive 연결됨' : 'OneDrive 연결이 필요합니다.'; }
  catch (error) { $('connection-status').textContent = error.message; }
}

if (typeof document !== 'undefined') main();
