export const DOCUMENT_TYPES = [
  ['food_transport', '식품운반업'], ['livestock_transport', '축산물운반업'],
  ['freight_license', '화물운송사자격증'], ['vehicle_registration', '차량등록증'],
  ['identity', '신분증'], ['health_certificate', '보건증']
];
export function validateDocumentFile(file) {
  if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('JPG, PNG, WEBP 사진을 선택해 주세요.');
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error('사진은 10MB 이하만 선택할 수 있습니다.');
}
// Adapter is deliberately absent until the authenticated OneDrive service is connected.
// Never put Graph access/refresh tokens or persistent document data in browser storage.
export function mountDriverDocuments(host, { getExpiry, adapter = null } = {}) {
  let driverId = null, generation = 0, busy = false;
  const urls = new Set();
  const clearUrls = () => { urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); };
  function reset(id) {
    generation++;
    driverId = id || null;
    clearUrls();
    host.replaceChildren();
    const title = document.createElement('h3');
    title.textContent = '기사 서류 사진';
    title.className = 'font-semibold text-sm';
    host.append(title);
    const note = document.createElement('p');
    note.className = 'text-xs text-zinc-400';
    note.textContent = adapter ? '서류 종류별로 사진을 선택해 업로드하세요.' : 'OneDrive 연결 대기 · 사진 선택과 미리보기만 가능합니다. 사진은 아직 저장되지 않습니다.';
    host.append(note);
    if (!driverId) {
      const hint = document.createElement('p');
      hint.textContent = '기사 기본 정보를 먼저 저장한 후 사진을 선택하세요.';
      host.append(hint);
      return;
    }
    for (const [kind,label] of DOCUMENT_TYPES) {
      const box = document.createElement('div');
      box.className = 'border border-zinc-700 rounded p-2 space-y-2';
      const caption = document.createElement('label');
      caption.textContent = label;
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
      input.className = 'block w-full text-xs'; caption.append(input);
      const preview = document.createElement('img');
      preview.alt = label + ' 선택 사진 미리보기'; preview.hidden = true;
      preview.className = 'max-h-40 max-w-full object-contain';
      const status = document.createElement('p'); status.className = 'text-xs text-zinc-400';
      const upload = document.createElement('button');
      upload.type = 'button'; upload.className = 'btn btn-primary text-xs';
      upload.textContent = adapter ? 'OneDrive 업로드' : 'OneDrive 연결 대기';
      upload.disabled = true;
      let file = null, url = null;
      input.addEventListener('change', () => {
        if (url) { URL.revokeObjectURL(url); urls.delete(url); }
        file = null; preview.hidden = true; preview.removeAttribute('src'); upload.disabled = true;
        if (!input.files?.[0]) { status.textContent = ''; return; }
        try {
          validateDocumentFile(input.files[0]);
          file = input.files[0]; url = URL.createObjectURL(file); urls.add(url);
          preview.src = url; preview.hidden = false;
          status.textContent = file.name + ' · 선택됨 (미저장)';
          upload.disabled = !adapter || busy;
        } catch (error) { input.value = ''; status.textContent = error.message; }
      });
      upload.addEventListener('click', async () => {
        if (!adapter || !file || busy) return;
        const expiry = getExpiry?.() || null;
        if (kind === 'health_certificate' && !expiry) { status.textContent = '보건증 만료일을 먼저 입력하고 저장해 주세요.'; return; }
        const version = generation, id = driverId;
        busy = true; upload.disabled = true; input.disabled = true;
        status.textContent = '업로드 중…';
        try {
          await adapter.upload({ driverId: id, kind, file, expiresOn: kind === 'health_certificate' ? expiry : null });
          if (generation === version) status.textContent = 'OneDrive 저장 완료';
        } catch (error) {
          if (generation === version) status.textContent = '업로드 실패: ' + error.message;
        } finally { busy = false; if (generation === version) { upload.disabled = !file; input.disabled = false; } }
      });
      box.append(caption, preview, status, upload); host.append(box);
    }
  }
  window.addEventListener('pagehide', clearUrls);
  reset(null);
  return { reset };
}
