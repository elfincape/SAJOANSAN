/// <reference lib="webworker" />
import { PGlite } from '@electric-sql/pglite';
import wasmUrl from '../../node_modules/@electric-sql/pglite/dist/pglite.wasm?url';
import initUrl from '../../node_modules/@electric-sql/pglite/dist/initdb.wasm?url';
import dataUrl from '../../node_modules/@electric-sql/pglite/dist/pglite.data?url';
import cryptoUrl from '../../node_modules/@electric-sql/pglite/dist/pgcrypto.tar.gz?url';
import base from '../../../repo-root/sql/private-mail.sql?raw';
import automation from '../../../supabase/sql/private-mail-automation.sql?raw';
import filters from '../../../supabase/sql/private-mail-filters.sql?raw';
import manual from '../../../supabase/sql/private-mail-manual.sql?raw';
import history from '../../../supabase/sql/private-mail-history.sql?raw';
import dates from '../../../supabase/sql/private-mail-message-dates.sql?raw';
import jev from '../../../supabase/sql/private-mail-jev-review.sql?raw';
import {
  replayIsolatedCase,
  prepareIsolatedMailCase,
} from '../../../supabase/functions/onedrive-auth/private-mail-isolated-storage.js';
import { renderDailyBriefing } from '../../../supabase/functions/onedrive-auth/private-mail-briefing-model.js';
import { fixtureById } from '../../../supabase/functions/onedrive-auth/private-mail-stress-fixtures.js';
const allowed = new Set(
  [wasmUrl, initUrl, dataUrl, cryptoUrl].map(
    (url) => new URL(url, self.location.href).href,
  ),
);
const originalFetch = self.fetch.bind(self);
self.fetch = (input, options) => {
  const url = new URL(
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
    self.location.href,
  ).href;
  if (!allowed.has(url))
    return Promise.reject(Error('ISOLATED_NETWORK_DENIED'));
  return originalFetch(input, options);
};
const dependencies = Promise.all([
  fetch(wasmUrl)
    .then((r) => r.arrayBuffer())
    .then((b) => WebAssembly.compile(b)),
  fetch(initUrl)
    .then((r) => r.arrayBuffer())
    .then((b) => WebAssembly.compile(b)),
  fetch(dataUrl).then((r) => r.blob()),
]).then(([pgliteWasmModule, initdbWasmModule, fsBundle]) => ({
  PGlite: class extends PGlite {
    constructor(options: Record<string, unknown> = {}) {
      super({ ...options, pgliteWasmModule, initdbWasmModule, fsBundle });
    }
  },
  pgcrypto: {
    name: 'pgcrypto',
    setup: async () => ({ bundlePath: new URL(cryptoUrl, self.location.href) }),
  },
  sqlSources: [base, automation, filters, manual, history, dates, jev],
}));
let session: Awaited<ReturnType<typeof prepareIsolatedMailCase>> | null = null;
let working = false;
self.onmessage = async (event) => {
  if (working) {
    self.postMessage({ status: 'failed', error: 'ISOLATED_BUSY' });
    return;
  }
  working = true;
  try {
    if (event.data?.operation === 'prepare') {
      if (session) throw Error('ISOLATED_ALREADY_PREPARED');
      session = await prepareIsolatedMailCase(
        'mail-old-sent-collected-today',
        await dependencies,
      );
      self.postMessage({
        status: 'queued',
        queued: session.queued,
        receipt: session.receipt,
      });
    } else if (event.data?.operation === 'finish') {
      if (!session) throw Error('ISOLATED_NOT_PREPARED');
      const result = await session.finish(event.data.result);
      const f = fixtureById('mail-old-sent-collected-today');
      const note =
        result.status === 'passed'
          ? renderDailyBriefing({ now: f.now, analyses: [result.roundTrip] })
              .managedHtml
          : null;
      self.postMessage({
        ...result,
        noteHtml: note,
        oneNoteWritten: false,
        engineAssetsDownloaded: true,
        dataTransmitted: false,
      });
    } else {
      self.postMessage({
        ...(await replayIsolatedCase(event.data, await dependencies)),
        engineAssetsDownloaded: true,
        dataTransmitted: false,
      });
    }
  } catch {
    self.postMessage({
      caseId: event.data?.caseId,
      status: 'failed',
      error: 'ISOLATED_STORAGE_FAILED',
      productionWritten: false,
    });
  } finally {
    working = false;
  }
};
