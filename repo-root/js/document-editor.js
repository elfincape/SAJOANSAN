import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { requireRole } from './auth.js';
import { withCenterParam } from './center.js';

const element = (id) => document.getElementById(id);
let editor;
let storageKey;
let saveTimer;
let dirty = false;

function message(text, error = false) {
  element('status').textContent = text;
  element('status').classList.toggle('error', error);
}

function saveDraft() {
  clearTimeout(saveTimer);
  try {
    localStorage.setItem(storageKey, JSON.stringify({ title: element('document-title').value, content: editor.getJSON() }));
    dirty = false;
    message(`이 브라우저에 저장됨 · ${new Date().toLocaleTimeString('ko-KR')}`);
    return true;
  } catch {
    message('초안 저장에 실패했습니다. 브라우저 저장 공간과 설정을 확인하고 파일로 다운로드하세요.', true);
    return false;
  }
}

function changed() {
  dirty = true;
  clearTimeout(saveTimer);
  message('변경 중 · 잠시 후 자동 저장');
  saveTimer = setTimeout(saveDraft, 600);
  updateToolbar();
}

function updateToolbar() {
  for (const button of document.querySelectorAll('[data-command][aria-pressed]')) {
    button.setAttribute('aria-pressed', String(editor.isActive(button.dataset.command)));
  }
  element('block-style').value = String([1, 2, 3].find((level) => editor.isActive('heading', { level })) || 0);
  document.querySelector('[data-command="undo"]').disabled = !editor.can().undo();
  document.querySelector('[data-command="redo"]').disabled = !editor.can().redo();
  element('counts').textContent = `${editor.getText().length.toLocaleString()}자`;
}

function download(format) {
  clearTimeout(saveTimer);
  saveDraft();
  const title = element('document-title').value.trim() || '제목 없는 문서';
  let content = '\uFEFF' + editor.getText({ blockSeparator: '\r\n\r\n' });
  if (format === 'html') {
    const escapedTitle = title.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
    content = `<!doctype html>\n<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapedTitle}</title><style>body{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 24px;line-height:1.8;overflow-wrap:anywhere}blockquote{border-left:3px solid #aaa;padding-left:20px}pre{white-space:pre-wrap}</style></head><body>${editor.getHTML()}</body></html>`;
  }
  const url = URL.createObjectURL(new Blob([content], { type: format === 'html' ? 'text/html;charset=utf-8' : 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) + '.' + (format === 'html' ? 'html' : 'txt');
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function init() {
  const profile = await requireRole('editor');
  if (!profile) return;
  element('back-link').href = withCenterParam('/admin/');
  element('user-badge').textContent = profile.display_name || profile.email || '';
  storageKey = `sajoansan:document:${profile.id}`;
  let draft = null;
  let loadError = false;
  try {
    draft = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (draft && (typeof draft.title !== 'string' || draft.content?.type !== 'doc')) throw new Error('Invalid document');
  } catch { draft = null; loadError = true; }
  element('document-title').value = draft?.title || '';
  editor = new Editor({
    element: element('document-content'),
    extensions: [StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, protocols: ['http', 'https', 'mailto'], HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' } } })],
    content: draft?.content || { type: 'doc', content: [{ type: 'paragraph' }] },
    editorProps: { attributes: { role: 'textbox', 'aria-label': '문서 본문', 'aria-multiline': 'true' } },
    onUpdate: changed,
    onSelectionUpdate: updateToolbar,
    onTransaction: () => { if (editor) updateToolbar(); },
  });
  element('document-title').oninput = changed;
  element('block-style').onchange = () => {
    const level = Number(element('block-style').value);
    if (level) editor.chain().focus().setHeading({ level }).run();
    else editor.chain().focus().setParagraph().run();
  };
  element('editor-toolbar').onclick = (event) => {
    const button = event.target.closest('button[data-command]');
    if (!button) return;
    const command = button.dataset.command;
    const chain = editor.chain().focus();
    if (command === 'link') {
      const address = prompt('링크 주소를 입력하세요 (https://, http://, mailto:).', editor.getAttributes('link').href || 'https://');
      if (address === null) return;
      const href = address.trim();
      if (!href) { chain.extendMarkRange('link').unsetLink().run(); return; }
      try {
        const url = new URL(href);
        if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) throw new Error('Invalid protocol');
        chain.extendMarkRange('link').setLink({ href: url.href }).run();
      } catch { message('링크 주소를 확인하세요. http://, https:// 또는 mailto:로 시작해야 합니다.', true); }
      return;
    }
    const commands = { bold: 'toggleBold', italic: 'toggleItalic', underline: 'toggleUnderline', strike: 'toggleStrike', bulletList: 'toggleBulletList', orderedList: 'toggleOrderedList', blockquote: 'toggleBlockquote', unlink: 'unsetLink', undo: 'undo', redo: 'redo' };
    const method = commands[command];
    if (method) chain[method]().run();
    updateToolbar();
  };
  element('save-document').onclick = saveDraft;
  element('export-html').onclick = () => download('html');
  element('export-text').onclick = () => download('text');
  element('new-document').onclick = () => {
    if (!confirm('현재 초안을 비우고 새 문서를 만들까요? 필요한 문서는 먼저 다운로드하세요.')) return;
    clearTimeout(saveTimer);
    editor.commands.clearContent();
    element('document-title').value = '';
    saveDraft();
    editor.commands.focus();
  };
  window.addEventListener('pagehide', () => { if (dirty) saveDraft(); });
  window.addEventListener('beforeunload', (event) => { if (dirty && !saveDraft()) { event.preventDefault(); event.returnValue = ''; } });
  element('workspace').disabled = false;
  updateToolbar();
  message(loadError ? '저장된 초안을 읽지 못했습니다. 새 내용을 입력하면 기존 브라우저 초안이 교체됩니다.' : draft ? '이 브라우저의 초안을 불러왔습니다.' : '본문을 클릭해 문서를 작성하세요. 변경 내용은 자동 저장됩니다.', loadError);
}

init().catch((error) => message('문서 도구 초기화 실패: ' + error.message, true));
