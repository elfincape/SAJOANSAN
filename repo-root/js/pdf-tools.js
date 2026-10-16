import { PDFDocument, degrees } from 'pdf-lib';

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const $ = id => document.getElementById(id);

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = filename;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function button(label, handler) {
  const node = document.createElement('button');
  node.type = 'button'; node.className = 'btn btn-ghost text-xs';
  node.textContent = label; node.addEventListener('click', handler);
  return node;
}

function fileKind(file) {
  if (/\.pdf$/i.test(file.name)) return 'pdf';
  if (/\.(jpg|jpeg)$/i.test(file.name)) return 'jpg';
  if (/\.png$/i.test(file.name)) return 'png';
  throw new Error('PDF, JPG, PNG 파일만 추가할 수 있습니다.');
}

function parseRange(value, count) {
  if (!value.trim()) throw new Error('추출할 페이지 범위를 입력해 주세요.');
  const positions = [];
  for (const token of value.split(',')) {
    const match = token.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('페이지 범위는 1-3, 5 형식으로 입력해 주세요.');
    const first = Number(match[1]); const last = Number(match[2] || match[1]);
    if (first < 1 || last > count || first > last) throw new Error(`페이지 범위는 1~${count} 이내여야 합니다.`);
    for (let position = first; position <= last; position++) {
      if (!positions.includes(position - 1)) positions.push(position - 1);
    }
  }
  return positions;
}

export function initializePdfTools({ state, renderPage, hideZoom }) {
  const inputs = [];
  let current = 0;
  let viewerRequest = 0;
  let viewerTask = Promise.resolve();
  let workingCards = [];
  let editingPdf = null;
  const locked = () => state.loading || state.saving || state.toolBusy;
  const status = message => { $('pdf-tool-status').textContent = message; };

  async function run(task, completed = '다운로드 준비 완료') {
    if (locked()) { status('현재 작업이 끝난 뒤 다시 시도해 주세요.'); return; }
    state.toolBusy = true;
    status('처리 중…');
    try { await task(); status(completed); }
    catch (error) { status(error.message); }
    finally { state.toolBusy = false; }
  }

  function showCurrent() {
    const request = ++viewerRequest;
    const pdf = state.pdf;
    const card = workingCards[current];
    const viewer = $('pdf-tool-viewer');
    for (const canvas of viewer.querySelectorAll('canvas')) canvas.width = canvas.height = 0;
    viewer.replaceChildren();
    if (!pdf || !card || state.loading) return;
    viewer.textContent = '페이지 불러오는 중…';
    const width = 800 * Number($('pdf-tool-zoom').value);
    viewerTask = viewerTask.catch(() => {}).then(async () => {
      if (request !== viewerRequest) return;
      const canvas = await renderPage(pdf, card.pageNumber, width);
      if (request !== viewerRequest || pdf !== state.pdf) { canvas.width = canvas.height = 0; return; }
      canvas.style.maxWidth = 'none';
      viewer.replaceChildren(canvas);
    }).catch(error => { if (request === viewerRequest) viewer.textContent = error.message; });
  }

  function syncPage() {
    current = Math.max(0, Math.min(current, workingCards.length - 1));
    $('pdf-tool-page').value = String(current + 1);
    $('pdf-tool-page').max = String(workingCards.length);
    $('pdf-tool-count').textContent = `/ ${workingCards.length} 페이지`;
    $('pdf-tool-prev').disabled = current === 0;
    $('pdf-tool-next').disabled = current >= workingCards.length - 1;
    showCurrent();
  }

  function refresh() {
    $('pdf-tool-editor').hidden = !state.pdf || state.loading || !state.cards.length;
    if (state.loading) { viewerRequest++; return; }
    if (editingPdf !== state.pdf) {
      editingPdf = state.pdf;
      workingCards = [...state.cards];
      current = 0;
    }
    for (const card of workingCards) {
      if (card.tools) continue;
      card.rotation = 0;
      const controls = document.createElement('div'); controls.className = 'flex flex-wrap gap-1';
      const move = direction => {
        if (locked()) return;
        const index = workingCards.indexOf(card); const target = index + direction;
        if (target < 0 || target >= workingCards.length) return;
        [workingCards[index], workingCards[target]] = [workingCards[target], workingCards[index]];
        $('pages').append(...workingCards.map(item => item.root), ...state.cards.filter(item => !workingCards.includes(item)).map(item => item.root));
        current = target; hideZoom(); syncPage();
      };
      controls.append(
        button('이 페이지 보기', () => { if (!locked()) { current = workingCards.indexOf(card); syncPage(); } }),
        button('앞으로', () => move(-1)), button('뒤로', () => move(1)),
        button('90° 회전', () => run(async () => {
          await viewerTask;
          card.rotation = (card.rotation + 90) % 360;
          hideZoom();
          const canvas = await renderPage(state.pdf, card.pageNumber, 190);
          canvas.className = 'max-h-full max-w-full object-contain';
          for (const previous of card.preview.querySelectorAll('canvas')) previous.width = previous.height = 0;
          card.preview.replaceChildren(canvas);
          current = workingCards.indexOf(card); syncPage();
        }, '페이지를 회전했습니다.')),
        button('편집 PDF에서 삭제', () => {
          if (locked()) return;
          if (workingCards.length < 2) { status('최소 한 페이지는 남겨 주세요.'); return; }
          workingCards.splice(workingCards.indexOf(card), 1);
          controls.hidden = true;
          const excluded = document.createElement('p'); excluded.className = 'text-xs text-amber-300';
          excluded.textContent = '편집 PDF에서 제외됨 · 원본 기사 서류 등록 가능';
          card.root.append(excluded);
          $('pages').append(card.root); hideZoom(); syncPage();
        })
      );
      card.root.append(controls); card.tools = controls;
    }
    syncPage();
  }

  function renderInputs() {
    $('pdf-tool-inputs').replaceChildren(...inputs.map((file, index) => {
      const row = document.createElement('li'); row.className = 'flex flex-wrap items-center gap-2 text-sm';
      const name = document.createElement('span'); name.className = 'break-all'; name.textContent = `${index + 1}. ${file.name}`;
      const move = direction => {
        if (locked()) return;
        const target = index + direction;
        if (target < 0 || target >= inputs.length) return;
        [inputs[index], inputs[target]] = [inputs[target], inputs[index]]; renderInputs();
      };
      row.append(name, button('앞으로', () => move(-1)), button('뒤로', () => move(1)), button('제거', () => {
        if (!locked()) { inputs.splice(index, 1); renderInputs(); }
      }));
      return row;
    }));
  }

  async function savePages(positions, suffix) {
    if (!state.sourceBytes || !positions.length) throw new Error('PDF를 먼저 불러와 주세요.');
    const source = await PDFDocument.load(state.sourceBytes);
    const output = await PDFDocument.create();
    const cards = positions.map(position => workingCards[position]);
    const pages = await output.copyPages(source, cards.map(card => card.pageNumber - 1));
    pages.forEach((page, index) => {
      page.setRotation(degrees((page.getRotation().angle + cards[index].rotation) % 360));
      output.addPage(page);
    });
    downloadBlob(new Blob([await output.save()], { type: 'application/pdf' }), `${state.filename}-${suffix}.pdf`);
  }

  async function downloadImages(cards) {
    if (!state.pdf || !cards.length) throw new Error('변환할 페이지를 선택해 주세요.');
    await viewerTask;
    const format = $('pdf-tool-format').value;
    for (const card of cards) {
      status(`${card.pageNumber}페이지 이미지 변환 중…`);
      const canvas = await renderPage(state.pdf, card.pageNumber, 1800);
      try {
        const blob = await new Promise((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new Error('이미지 변환에 실패했습니다.')), format === 'png' ? 'image/png' : 'image/jpeg', 0.9));
        downloadBlob(blob, `${state.filename}-page-${card.pageNumber}.${format}`);
      } finally { canvas.width = canvas.height = 0; }
    }
  }

  $('pdf-tool-files').addEventListener('change', event => {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (locked()) { status('현재 작업이 끝난 뒤 파일을 추가해 주세요.'); return; }
    try {
      for (const file of files) {
        fileKind(file);
        if (!file.size || file.size > MAX_FILE_BYTES) throw new Error('각 파일은 0바이트보다 크고 50MB 이하여야 합니다.');
      }
      if ([...inputs, ...files].reduce((total, file) => total + file.size, 0) > MAX_TOTAL_BYTES) throw new Error('추가한 파일의 합계는 100MB 이하여야 합니다.');
      inputs.push(...files); renderInputs(); status(`${inputs.length}개 파일 준비됨`);
    } catch (error) { status(error.message); }
  });
  $('pdf-tool-merge').addEventListener('click', () => run(async () => {
    if (!inputs.length) throw new Error('PDF 또는 이미지를 추가해 주세요.');
    const output = await PDFDocument.create();
    for (const file of inputs) {
      const bytes = await file.arrayBuffer(); const kind = fileKind(file);
      if (kind === 'pdf') {
        const source = await PDFDocument.load(bytes);
        for (const page of await output.copyPages(source, source.getPageIndices())) output.addPage(page);
      } else {
        const image = kind === 'png' ? await output.embedPng(bytes) : await output.embedJpg(bytes);
        const scale = Math.min(1, 14400 / Math.max(image.width, image.height));
        const width = image.width * scale; const height = image.height * scale;
        output.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
      }
    }
    downloadBlob(new Blob([await output.save()], { type: 'application/pdf' }), 'combined.pdf');
  }));
  $('pdf-tool-prev').addEventListener('click', () => { if (!locked()) { current--; syncPage(); } });
  $('pdf-tool-next').addEventListener('click', () => { if (!locked()) { current++; syncPage(); } });
  $('pdf-tool-page').addEventListener('change', () => {
    if (locked()) return;
    const page = Number($('pdf-tool-page').value);
    current = Number.isInteger(page) ? page - 1 : 0; syncPage();
  });
  $('pdf-tool-zoom').addEventListener('change', () => { if (!locked()) showCurrent(); });
  $('pdf-tool-save').addEventListener('click', () => run(() => savePages(workingCards.map((card, index) => index), 'edited')));
  $('pdf-tool-extract').addEventListener('click', () => run(() => savePages(parseRange($('pdf-tool-range').value, workingCards.length), 'extracted')));
  $('pdf-tool-current-image').addEventListener('click', () => run(() => downloadImages([workingCards[current]].filter(Boolean))));
  $('pdf-tool-selected-images').addEventListener('click', () => run(() => downloadImages(workingCards.filter(card => card.checkbox.checked))));
  return { refresh, beforeLoad: async () => { viewerRequest++; await viewerTask; } };
}
