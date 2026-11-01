import { APPROVED_MAIL_TARGET as TARGET } from './private-mail-policy.js';
import { BRIEFING_TARGET } from './private-mail-briefing-model.js';
import { writeDailyBriefing } from './private-mail-notes-writer.js';
import { fixtureById } from './private-mail-stress-fixtures.js';

const CASE = 'mail-old-sent-collected-today';
const PURPOSE = 'private-mail-virtual-note-v1';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const enc = encodeURIComponent;
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export async function issueStressNoteProof(result, receiptId, ctx) {
  if (result.caseId !== CASE || result.automatedChecksPassed !== true || result.saved?.source?.id !== receiptId || !uuid.test(receiptId)) return null;
  if (typeof ctx.sealDiagnostic !== 'function') return null;
  if (JSON.stringify(result.saved).length > 64000) throw Error('STRESS_NOTE_RESULT_LIMIT');
  return ctx.sealDiagnostic({ purpose: PURPOSE, owner: TARGET.owner_id, caseId: CASE,
    receiptId, expiresAt: Date.now() + 86400000, saved: result.saved });
}
export async function writeStressNote({ proof, stored }, ctx) {
  if (typeof proof !== 'string' || proof.length > 128000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(proof) || typeof ctx.openDiagnostic !== 'function') throw Error('STRESS_NOTE_PROOF');
  let approved;
  try { approved = await ctx.openDiagnostic(proof); } catch { throw Error('STRESS_NOTE_PROOF'); }
  if (approved?.purpose !== PURPOSE || approved.owner !== TARGET.owner_id || approved.caseId !== CASE ||
      !uuid.test(approved.receiptId ?? '') || !Number.isFinite(approved.expiresAt) || approved.expiresAt <= Date.now() ||
      approved.saved?.source?.id !== approved.receiptId) throw Error('STRESS_NOTE_PROOF');
  if (!stored || JSON.stringify(stored).length > 64000 || JSON.stringify(canonical(stored)) !== JSON.stringify(canonical(approved.saved))) throw Error('STRESS_NOTE_SQL_MISMATCH');
  if (typeof ctx.diagnosticNotes !== 'function') throw Error('STRESS_NOTE_CONNECTION');
  const fixture = fixtureById(CASE), title = '가상 검증 ' + approved.receiptId;
  const marker = 'private-mail-note-test:' + approved.receiptId;
  return ctx.diagnosticNotes(async (connection, graph = ctx.graph) => {
    const checkedGraph = async (path, access, options) => {
      const stage = path.includes('/notebooks/') ? 'notebook' : path.includes('/sections/')
        ? options?.method === 'POST' ? 'create' : path.includes('/pages') ? 'list' : 'section'
        : path.includes('/content') ? options?.method === 'PATCH' ? 'update' : 'readback' : 'metadata';
      try { return await graph(path, access, options); }
      catch (error) { throw Object.assign(error, { stressNoteStage: stage }); }
    };
    const attempts = await ctx.db('onedrive_locks?select=name,holder,expires_at&name=eq.' + enc(marker));
    if (attempts.some(row => row.holder !== approved.receiptId)) throw Error('STRESS_NOTE_ATTEMPT_CONFLICT');
    let state = { createAttempted: attempts.length > 0 }, markerCreated = false;
    const lease = crypto.randomUUID();
    const store = {
      claim: async () => ({ lease, state: { ...state } }),
      save: async ({ day, lease: owner, value }) => {
        if (owner !== lease || day !== fixture.referenceDate) throw Error('STRESS_NOTE_LEASE');
        state = { ...state, ...value };
      },
      release: async () => {},
    };
    const write = () => writeDailyBriefing({ now: fixture.now, analyses: [approved.saved], store,
      connected: async () => connection, graph: checkedGraph, hash: async value => {
        const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
      }, diagnosticRunId: approved.receiptId, beforeCreate: async () => {
        await ctx.db('onedrive_locks', { method: 'POST', body: { name: marker, holder: approved.receiptId, expires_at: new Date(approved.expiresAt).toISOString() } });
        markerCreated = true;
      } });
    let first, repeat;
    try { first = await write(); repeat = await write(); }
    catch (error) {
      if (markerCreated && error?.createRejected === true) await ctx.db('onedrive_locks?name=eq.' + enc(marker) + '&holder=eq.' + approved.receiptId, { method: 'DELETE' });
      throw error;
    }
    if (first.pageId !== repeat.pageId || repeat.status !== 'skipped') throw Error('STRESS_NOTE_REPEAT');
    const page = await (await checkedGraph('/me/onenote/pages/' + enc(first.pageId) + '?$select=id,title,links&$expand=parentSection($select=id)', connection.accessToken)).json();
    if (page.id !== first.pageId || page.title !== title || page.parentSection?.id !== BRIEFING_TARGET.sectionId) throw Error('STRESS_NOTE_TARGET');
    let pageUrl = null;
    try { const url = new URL(page.links?.oneNoteWebUrl?.href); if (url.protocol === 'https:' && ['onedrive.live.com', 'www.onenote.com'].includes(url.hostname)) pageUrl = url.href; } catch {}
    return { status: 'passed', title, pageId: first.pageId, pageUrl, sectionId: BRIEFING_TARGET.sectionId,
      firstStatus: first.status, repeatStatus: repeat.status, readBackVerified: true,
      writePerformed: ['created', 'updated', 'reconciled'].includes(first.status), oneNoteWritten: true,
      diagnosticStateWritten: markerCreated, productionBusinessWritten: false, modelCalled: false };
  });
}
