import { APPROVED_MAIL_TARGET as TARGET } from './private-mail-policy.js';
import {
  analyzePrivateMail,
  MAIL_ANALYSIS_MODEL,
} from './private-mail-analysis.js';
import { callHaiku } from '../_shared/haiku.js';
import { writeDailyBriefing } from './private-mail-notes-writer.js';
import {
  collectionProgress,
  validateCollection,
} from './private-mail-collection-state.js';
import {
  dailyReportIdentity,
  dailyBriefingView,
} from './private-mail-briefing-model.js';
const uuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value ?? '',
  );
const day = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') &&
  new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const enc = encodeURIComponent;
export async function handleMailAutomation(action, body, user, ctx) {
  const { db, json, fail, fetcher, graph, connectedNotes, loadMail } = ctx;
  if (user.id !== TARGET.owner_id) throw fail('OWNER_REQUIRED', 403);
  const rpc = (name, values) =>
    db('rpc/' + name, { method: 'POST', body: values });
  const box = async () => {
    const row = (
      await db('private_mailboxes?select=*&id=eq.' + TARGET.mailbox_id)
    )[0];
    if (!row || row.owner_id !== TARGET.owner_id)
      throw fail('MAILBOX_TARGET_REJECTED', 403);
    return row;
  };
  const current = await box();
  const ready = Object.hasOwn(current, 'automation_config');
  async function workerProbe() {
    try {
      const response = await fetcher(
        'https://sajoansan.vercel.app/api/private-mail-worker',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ kind: 'probe', mailboxId: TARGET.mailbox_id }),
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
        },
      );
      return response.ok && (await response.json()).configured === true;
    } catch {
      return false;
    }
  }
  if (action === 'private-mail-automation-status') {
    const config = current.automation_config ?? {},
      job = current.automation_job;
    const notes =
      (
        await db(
          'onedrive_connection?select=id&encrypted_notes_tokens=not.is.null',
        )
      ).length > 0;
    const schedulerReady = ready
      ? await rpc('private_mail_scheduler_ready', {})
      : false;
    const workerReady = await workerProbe();
    const recent = ready
      ? await db(
          'private_mail_messages?select=id,subject,sent_at,created_at,analysis_status,analysis_error&mailbox_id=eq.' +
            current.id +
            '&order=created_at.desc&limit=25',
        )
      : [];
    return json({
      schemaReady: ready,
      workerReady,
      schedulerReady,
      notesConnected: notes,
      analysisReady: !!ctx.aiKey,
      config: {
        enabled: config.enabled === true,
        readStateVerified: config.readStateVerified === true,
        analysisConsent: config.analysisConsent === true,
        analysisConsentAt: config.analysisConsentAt ?? null,
      },
      nextRunAt: current.automation_next_at ?? null,
      job: job
        ? {
            id: job.id,
            status: job.status,
            stopRequested: job.stopRequested,
            error: job.error,
            updatedAt: job.updatedAt,
          }
        : null,
      progress: current.last_counts?.cycle
        ? collectionProgress(current.last_counts.cycle)
        : null,
      reports: Object.entries(current.briefing_pages ?? {})
        .sort(([a], [b]) => b.localeCompare(a))
        .slice(0, 14)
        .map(([date, value]) => ({
          day: date,
          dirty: value.dirty === true,
          error: value.error ?? null,
          pageId: value.pageId ?? null,
        })),
      recent,
    });
  }
  if (!ready) throw fail('AUTOMATION_SCHEMA_REQUIRED', 503);
  if (action === 'private-mail-daily-overview') {
    const date = body.day ?? dailyReportIdentity().day;
    if (!day(date)) throw fail('REPORT_DATE');
    const analyses = await reportAnalyses(date);
    return json(
      dailyBriefingView({
        now: date + 'T12:00:00+09:00',
        analyses,
        overrides: current.briefing_overrides ?? {},
      }),
    );
  }
  if (action === 'private-mail-analyze-one') {
    if (!uuid(body.id)) throw fail('ANALYSIS_SOURCE');
    const connection = await connectedNotes();
    if (connection.notesGranted !== true)
      throw fail('NOTES_PERMISSION_REQUIRED', 409);
    const selection = await rpc('private_mail_analysis_select', {
      p_box: current.id,
      p_message: body.id,
      p_user: user.id,
    });
    if (selection.excluded)
      return json({ status: 'excluded', reportDay: selection.reportDay });
    if (selection.analysis_status === 'ready')
      return json({ status: 'done', reportDay: selection.reportDay });
    const response = await handleMailAutomation(
      'private-mail-background-work',
      { operation: 'analyze', mailbox: current.id, id: body.id },
      user,
      { ...ctx, background: true },
    );
    return json({ ...(await response.json()), reportDay: selection.reportDay });
  }
  if (action === 'private-mail-report-now') {
    if (!day(body.day)) throw fail('REPORT_DATE');
    return handleMailAutomation(
      'private-mail-background-work',
      { operation: 'report', mailbox: current.id, day: body.day },
      user,
      { ...ctx, background: true },
    );
  }
  async function reportAnalyses(date) {
    const analyses = [];
    for (let offset = 0; offset < 5000; offset += 100) {
      const rows = await db(
        'private_mail_messages?select=analysis,analysis_excluded,analysis_filter_override&mailbox_id=eq.' +
          current.id +
          '&analysis=not.is.null&report_day=eq.' +
          enc(date) +
          '&order=created_at.asc,id.asc&limit=100&offset=' +
          offset,
      );
      analyses.push(
        ...rows.map((row) => ({
          ...row.analysis,
          source: {
            ...row.analysis.source,
            excluded:
              row.analysis_excluded === true &&
              row.analysis_filter_override !== 'include',
          },
        })),
      );
      if (rows.length < 100) {
        if (ctx.relatedAnalyses) {
          const related = await ctx.relatedAnalyses(analyses);
          const seen = new Set(analyses.map((item) => item.source.id));
          for (const item of related)
            if (!seen.has(item.source.id)) {
              seen.add(item.source.id);
              analyses.push(item);
            }
        }
        return analyses;
      }
    }
    throw fail('REPORT_LIMIT', 409);
  }
  if (action === 'private-mail-automation-config') {
    if (typeof body.enabled !== 'boolean')
      throw fail('AUTOMATION_CONFIG_INVALID');
    const previous = current.automation_config ?? {};
    if (
      body.enabled &&
      (previous.approvalSource !== 'owner-request' ||
        previous.analysisConsent !== true ||
        !previous.analysisConsentAt)
    )
      throw fail('AUTOMATION_NOT_CONFIGURED', 409);
    if (
      body.enabled &&
      (!(await workerProbe()) ||
        !(await rpc('private_mail_scheduler_ready', {})))
    )
      throw fail('AUTOMATION_CONNECTION_REQUIRED', 409);
    if (body.enabled && !ctx.aiKey) throw fail('AI_NOT_CONFIGURED', 503);
    if (body.enabled && (await connectedNotes()).notesGranted !== true)
      throw fail('NOTES_PERMISSION_REQUIRED', 409);
    const config = {
      ...previous,
      enabled: body.enabled,
    };
    await db(
      'private_mailboxes?id=eq.' + current.id + '&owner_id=eq.' + user.id,
      {
        method: 'PATCH',
        body: {
          automation_config: config,
          ...(body.enabled && !previous.enabled
            ? { automation_next_at: new Date().toISOString() }
            : {}),
        },
      },
    );
    if (body.enabled) {
      await rpc('private_mail_job_start', { p_box: current.id, p_force: true });
      await rpc('private_mail_dispatch', { p_box: current.id });
    }
    return json({ saved: true, config });
  }
  if (action === 'private-mail-run-now') {
    if (
      !(await workerProbe()) ||
      !(await rpc('private_mail_scheduler_ready', {}))
    )
      throw fail('AUTOMATION_CONNECTION_REQUIRED', 409);
    const job = await rpc('private_mail_job_start', {
      p_box: current.id,
      p_force: true,
    });
    if (!job) throw fail('MAILBOX_BUSY_OR_AUTOMATION_DISABLED', 409);
    return json({ job: { id: job.id, status: job.status } });
  }
  if (action === 'private-mail-job-stop')
    return json({
      stopped: await rpc('private_mail_job_stop', { p_box: current.id }),
    });
  if (action !== 'private-mail-background-work' || !ctx.background)
    throw fail('WORKER_AUTH_REQUIRED', 403);
  if (body.mailbox !== current.id) throw fail('MAILBOX_TARGET_REJECTED', 403);
  if (body.operation === 'job-claim') {
    if (!uuid(body.id) || !uuid(body.lease)) throw fail('JOB_REQUEST_INVALID');
    return json({
      job: await rpc('private_mail_job_claim', {
        p_box: current.id,
        p_job: body.id,
        p_lease: body.lease,
      }),
    });
  }
  if (body.operation === 'job-finish') {
    if (!uuid(body.id) || !uuid(body.lease)) throw fail('JOB_REQUEST_INVALID');
    let receipt = null;
    if (body.progress) {
      receipt = validateCollection(current.last_counts?.cycle);
      const summary = collectionProgress(receipt);
      if (
        ['cycleId', 'total', 'processed', 'saved', 'remaining', 'phase'].some(
          (key) => summary[key] !== body.progress[key],
        )
      )
        throw fail('JOB_PROGRESS', 409);
    } else if (body.error && current.last_counts?.cycle?.requestId === body.id)
      receipt = current.last_counts.cycle;
    const job = await rpc('private_mail_job_finish', {
      p_box: current.id,
      p_job: body.id,
      p_lease: body.lease,
      p_progress: receipt,
      p_error: body.error ?? null,
    });
    return json({ job: { id: job.id, status: job.status, error: job.error } });
  }
  if (body.operation === 'analyze') {
    if (!uuid(body.id)) throw fail('ANALYSIS_SOURCE');
    const lease = crypto.randomUUID();
    const result = await analyzePrivateMail({
      messageId: body.id,
      key: ctx.aiKey,
      fetcher,
      loadMail,
      store: {
        claim: async (id) => {
          const rows = await rpc('private_mail_analysis_claim', {
            p_message: id,
            p_lease: lease,
          });
          return rows?.[0] ? { row: rows[0], lease } : null;
        },
        finish: ({ messageId, lease, analysis }) =>
          rpc('private_mail_analysis_finish', {
            p_message: messageId,
            p_lease: lease,
            p_analysis: analysis,
          }),
        exclude: ({ messageId, lease, match }) =>
          rpc('private_mail_filter_record', {
            p_message: messageId,
            p_lease: lease,
            p_match: match,
          }),
        fail: ({ messageId, lease, code }) =>
          rpc('private_mail_analysis_fail', {
            p_message: messageId,
            p_lease: lease,
            p_code: code,
          }),
      },
    });
    return json({
      status: result.status,
      ...(result.code ? { code: result.code } : {}),
    });
  }
  if (body.operation === 'report') {
    if (!day(body.day)) throw fail('REPORT_DATE');
    const lease = crypto.randomUUID();
    let claim = null;
    let reportStage = 'claim';
    const store = {
      claim: async () => claim,
      save: async ({ day, lease, value }) => {
        if (
          !(await rpc('private_mail_briefing_save', {
            p_box: current.id,
            p_day: day,
            p_lease: lease,
            p_value: value,
          }))
        )
          throw Error('BRIEFING_LEASE');
      },
      // The outer transaction boundary acknowledges the revision before releasing the day lease.
      release: async () => {},
    };
    try {
      const state = await rpc('private_mail_briefing_claim', {
        p_box: current.id,
        p_day: body.day,
        p_lease: lease,
      });
      if (!state) return json({ status: 'busy' });
      claim = { day: body.day, lease, state };
      reportStage = 'snapshot';
      const fresh = await box();
      const probe = fresh.automation_config?.modelProbe;
      if (probe?.status === 'pending' && uuid(probe.id)) {
        const started = {
          ...probe,
          status: 'started',
          startedAt: new Date().toISOString(),
        };
        const config = { ...fresh.automation_config, modelProbe: started };
        const claimed = await db(
          'private_mailboxes?id=eq.' +
            current.id +
            '&automation_config=eq.' +
            enc(JSON.stringify(fresh.automation_config)),
          {
            method: 'PATCH',
            body: { automation_config: config },
            prefer: 'return=representation',
          },
        );
        if (claimed?.length === 1) {
          let result;
          try {
            const response = await callHaiku({
              model: MAIL_ANALYSIS_MODEL,
              key: ctx.aiKey,
              fetcher,
              prompt: '연결 확인 테스트입니다. 다른 설명 없이 OK만 응답하세요.',
              maxTokens: 32,
            });
            result = {
              status: 'done',
              httpStatus: 200,
              model:
                typeof response.model === 'string' &&
                /^claude-[a-z0-9.-]{1,80}$/.test(response.model)
                  ? response.model
                  : 'unreported',
              normalResponse:
                response.content?.some(
                  (item) =>
                    item.type === 'text' &&
                    /^OK[.!\s]*$/i.test(item.text?.trim() ?? ''),
                ) === true,
            };
          } catch (error) {
            result = {
              status: 'failed',
              httpStatus: Number.isInteger(error?.providerStatus)
                ? error.providerStatus
                : null,
              code: [
                'MODEL_FAILED',
                'RATE_LIMITED',
                'AI_NOT_CONFIGURED',
              ].includes(error?.code)
                ? error.code
                : 'PROBE_FAILED',
            };
          }
          await db(
            'private_mailboxes?id=eq.' +
              current.id +
              '&automation_config=eq.' +
              enc(JSON.stringify(config)),
            {
              method: 'PATCH',
              body: {
                automation_config: {
                  ...config,
                  modelProbe: {
                    ...started,
                    ...result,
                    finishedAt: new Date().toISOString(),
                  },
                },
              },
            },
          );
        }
      }
      reportStage = 'analyses';
      const analyses = await reportAnalyses(body.day);
      reportStage = 'images';
      const images = analyses
        .filter((item) => !item.source.excluded)
        .flatMap((item) =>
          (item.source.images ?? [])
            .filter((image) =>
              ['image/jpeg', 'image/png'].includes(image.mediaType),
            )
            .map((image) => ({
              ...image,
              sourceId: item.source.id,
              byteSize: image.byteLength,
              sourceUrl:
                'https://sajoansan.vercel.app/portal/?view=mail&message=' +
                item.source.id,
            })),
        );
      const unsupportedPhotos = analyses.some(
        (item) =>
          !item.source.excluded &&
          (item.source.images ?? []).some(
            (image) => !['image/jpeg', 'image/png'].includes(image.mediaType),
          ),
      );

      reportStage = 'notes_writer';
      const result = await writeDailyBriefing({
        now: body.day + 'T12:00:00+09:00',
        analyses,
        overrides: fresh.briefing_overrides ?? {},
        images,
        loadImage: ctx.loadImage,
        maxImageBatches: 2,
        deadline: Date.now() + 180000,
        store,
        connected: async () => {
          reportStage = 'notes_connection';
          const connection = await connectedNotes();
          reportStage = 'notes_writer';
          return connection;
        },
        graph: async (path, access, options) => {
          reportStage = path.includes('/notebooks/')
            ? 'notebook'
            : path.includes('/sections/')
              ? options?.method === 'POST'
                ? 'page_create'
                : path.includes('/pages')
                  ? 'page_list'
                  : 'section'
              : options?.method === 'PATCH'
                ? 'page_update'
                : 'page_read';
          const response = await graph(path, access, options);
          reportStage = 'notes_writer';
          return response;
        },
        hash: async (value) => {
          const input =
            value instanceof Uint8Array
              ? value
              : new TextEncoder().encode(value);
          const bytes = new Uint8Array(
            await crypto.subtle.digest('SHA-256', input),
          );
          return [...bytes]
            .map((byte) => byte.toString(16).padStart(2, '0'))
            .join('');
        },
      });
      if (
        claim &&
        ['created', 'updated', 'skipped', 'reconciled'].includes(result.status)
      ) {
        await store.save({
          day: body.day,
          lease,
          value: {
            error: unsupportedPhotos ? 'NOTES_IMAGE_TYPE_UNSUPPORTED' : null,
            notBefore: null,
          },
        });
        await rpc('private_mail_briefing_complete', {
          p_box: current.id,
          p_day: body.day,
          p_lease: lease,
        });
      }
      return json({
        status: result.status,
        ...(unsupportedPhotos ? { code: 'NOTES_IMAGE_TYPE_UNSUPPORTED' } : {}),
      });
    } catch (error) {
      const code = /^[A-Z_]{1,64}$/.test(error?.message ?? '')
        ? error.message
        : 'NOTES_SYNC_FAILED';
      console.warn('PRIVATE_MAIL_REPORT_FAILED', {
        stage: reportStage,
        code,
        errorName: [
          'Error',
          'TypeError',
          'RangeError',
          'AbortError',
          'TimeoutError',
        ].includes(error?.name)
          ? error.name
          : 'other',
        status: Number.isInteger(error?.status) ? error.status : null,
        providerStatus: Number.isInteger(error?.providerStatus)
          ? error.providerStatus
          : null,
      });
      if (claim)
        await store.save({
          day: body.day,
          lease,
          value: {
            error: code,
            notBefore: new Date(Date.now() + 300000).toISOString(),
          },
        });
      return json({ status: 'waiting', code });
    } finally {
      if (claim)
        await rpc('private_mail_briefing_release', {
          p_box: current.id,
          p_day: body.day,
          p_lease: lease,
        });
    }
  }
  throw fail('WORKER_OPERATION_REJECTED');
}
