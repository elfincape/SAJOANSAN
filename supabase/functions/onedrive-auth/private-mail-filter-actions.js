import { APPROVED_MAIL_TARGET as TARGET } from './private-mail-policy.js';
import { validateMailRule, matchMailRules } from './private-mail-filter.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actions = new Set([
  'private-mail-filter-status',
  'private-mail-rules-preview',
  'private-mail-rules-save',
  'private-mail-filter-override',
  'private-mail-filter-apply-preview',
  'private-mail-item-status',
]);
const metadata =
  'id,subject,sender,sent_at,analysis_status,analysis_excluded,analysis_filter_override,analysis_exclusion';
const internal = metadata + ',mailbox_id,owner_id,files,created_at';
const publicMail = (row) =>
  Object.fromEntries(metadata.split(',').map((key) => [key, row[key] ?? null]));
const validDay = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const stamp = new Date(value + 'T00:00:00Z');
  return (
    Number.isFinite(stamp.getTime()) &&
    stamp.toISOString().slice(0, 10) === value
  );
};
function failureCode(error) {
  return [
    'FILTER_REPORT_CONFIRM_REQUIRED',
    'MAIL_FILTER_TIMEOUT',
    'MAIL_FILTER_BODY_UNAVAILABLE',
    'MAIL_NOT_FOUND',
    'MAILBOX_TARGET_REJECTED',
    'MAIL_RULE_INVALID',
    'MAIL_FILTER_BODY_REQUIRED',
    'FILTER_MATCH',
    'FILTER_SCOPE',
  ].includes(error?.message)
    ? error.message
    : 'MAIL_FILTER_UNRESOLVED';
}
export async function handleMailFilter(
  action,
  body,
  user,
  { db, json, fail, loadText },
) {
  const deadline = Date.now() + 90000;
  if (user?.id !== TARGET.owner_id) throw fail('OWNER_REQUIRED', 403);
  if (!actions.has(action)) throw fail('MAIL_FILTER_ACTION_INVALID', 400);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw fail('MAIL_FILTER_REQUEST_INVALID', 400);
  const current = (
    await db('private_mailboxes?select=*&id=eq.' + TARGET.mailbox_id)
  )[0];
  if (
    !current ||
    current.id !== TARGET.mailbox_id ||
    current.owner_id !== TARGET.owner_id
  )
    throw fail('MAILBOX_TARGET_REJECTED', 403);
  const schemaReady =
    Object.hasOwn(current, 'analysis_rules') &&
    Object.hasOwn(current, 'briefing_overrides');
  const rpc = (name, values) =>
    db('rpc/' + name, { method: 'POST', body: values });
  const scope =
    '&mailbox_id=eq.' + TARGET.mailbox_id + '&owner_id=eq.' + TARGET.owner_id;
  const checkRow = (row) => {
    if (
      !row ||
      !UUID.test(row.id ?? '') ||
      row.mailbox_id !== TARGET.mailbox_id ||
      row.owner_id !== TARGET.owner_id
    )
      throw fail('MAILBOX_TARGET_REJECTED', 403);
    return row;
  };
  const checkedRules = (value) => {
    if (!Array.isArray(value) || value.length > 50)
      throw fail('MAIL_RULE_INVALID', 400);
    let rules;
    try {
      rules = value.map(validateMailRule);
    } catch {
      throw fail('MAIL_RULE_INVALID', 400);
    }
    if (new Set(rules.map((rule) => rule.id)).size !== rules.length)
      throw fail('MAIL_RULE_INVALID', 400);
    return rules;
  };
  if (action === 'private-mail-filter-status') {
    const offset = body.offset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000)
      throw fail('MAIL_FILTER_REQUEST_INVALID', 400);
    const rows = schemaReady
      ? await db(
          'private_mail_messages?select=' +
            internal +
            scope +
            '&order=created_at.desc,id.desc&limit=26&offset=' +
            offset,
        )
      : [];
    return json({
      schemaReady,
      rules: schemaReady ? current.analysis_rules : [],
      offset,
      nextOffset: offset + Math.min(rows.length, 25),
      hasMore: rows.length > 25,
      messages: rows.slice(0, 25).map((row) => publicMail(checkRow(row))),
    });
  }
  if (!schemaReady) throw fail('MAIL_FILTER_SCHEMA_REQUIRED', 503);
  const confirm = body.confirmExisting === true;
  if (
    body.confirmExisting !== undefined &&
    typeof body.confirmExisting !== 'boolean'
  )
    throw fail('MAIL_FILTER_REQUEST_INVALID', 400);
  const remaining = () => deadline - Date.now();
  async function evaluate(
    row,
    rules,
    override = row.analysis_filter_override ?? 'inherit',
  ) {
    checkRow(row);
    if (remaining() <= 0) throw fail('MAIL_FILTER_TIMEOUT', 408);
    const needsBody =
      override === 'inherit' &&
      rules.some(
        (rule) =>
          rule.enabled &&
          rule.conditions.some((condition) => condition.field === 'body'),
      );
    let text;
    if (needsBody) {
      if (typeof loadText !== 'function')
        throw fail('MAIL_FILTER_BODY_UNAVAILABLE', 409);
      const controller = new AbortController();
      let timer;
      try {
        const source = await Promise.race([
          Promise.resolve().then(() =>
            loadText(row, { signal: controller.signal }),
          ),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => {
                controller.abort();
                reject(fail('MAIL_FILTER_TIMEOUT', 408));
              },
              Math.max(1, remaining()),
            );
          }),
        ]);
        text = typeof source === 'string' ? source : source?.text;
        if (typeof text !== 'string' || text.length > 100000)
          throw fail('MAIL_FILTER_BODY_UNAVAILABLE', 409);
      } catch (error) {
        if (error?.message === 'MAIL_FILTER_TIMEOUT') throw error;
        throw fail('MAIL_FILTER_BODY_UNAVAILABLE', 409);
      } finally {
        clearTimeout(timer);
      }
    }
    if (remaining() <= 0) throw fail('MAIL_FILTER_TIMEOUT', 408);
    try {
      return matchMailRules({
        mail: {
          subject: row.subject,
          sender: row.sender,
          ...(needsBody ? { text } : {}),
        },
        rules,
        override,
      });
    } catch (error) {
      throw fail(failureCode(error), 409);
    }
  }
  async function one(id) {
    if (!UUID.test(id ?? '')) throw fail('MAIL_FILTER_MESSAGE_INVALID', 400);
    const row = (
      await db(
        'private_mail_messages?select=' +
          internal +
          scope +
          '&id=eq.' +
          id.toLowerCase() +
          '&limit=1',
      )
    )[0];
    if (!row) throw fail('MAIL_NOT_FOUND', 404);
    return checkRow(row);
  }
  if (action === 'private-mail-rules-preview') {
    const rules = checkedRules([body.rule]);
    const offset = body.offset ?? 0,
      limit = body.limit ?? 5;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > 100000 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 5
    )
      throw fail('MAIL_FILTER_PAGE_INVALID', 400);
    const rows = await db(
      'private_mail_messages?select=' +
        internal +
        scope +
        '&order=created_at.desc,id.desc&offset=' +
        offset +
        '&limit=' +
        (limit + 1),
    );
    const matches = [],
      unresolved = [];
    for (const row of rows.slice(0, limit)) {
      checkRow(row);
      try {
        const result = await evaluate(row, rules, 'inherit');
        matches.push({
          id: row.id,
          subject: row.subject,
          sender: row.sender,
          matched: result.excluded,
          reason: result.reason,
          matchedFields: result.matchedFields,
        });
      } catch (error) {
        unresolved.push({ id: row.id, code: failureCode(error) });
      }
    }
    const scanned = Math.min(rows.length, limit);
    return json({
      matches,
      scanned,
      nextOffset: offset + scanned,
      more: rows.length > limit,
      unresolved,
    });
  }
  if (action === 'private-mail-rules-save') {
    const rules = checkedRules(body.rules);
    let old;
    try {
      old = checkedRules(current.analysis_rules);
    } catch {
      old = [];
    }
    if (
      rules.some(
        (rule) =>
          rule.enabled &&
          !old.some((prior) => JSON.stringify(prior) === JSON.stringify(rule)),
      ) &&
      body.previewConfirmed !== true
    )
      throw fail('MAIL_RULE_PREVIEW_REQUIRED', 409);
    return json({
      saved: true,
      rules: await rpc('private_mail_filter_rules_save', {
        p_box: TARGET.mailbox_id,
        p_rules: rules,
      }),
    });
  }
  if (action === 'private-mail-filter-override') {
    if (!['inherit', 'include', 'exclude'].includes(body.override))
      throw fail('FILTER_OVERRIDE', 400);
    const row = await one(body.id);
    // Complete local evaluation first, so read/parse errors preserve the current choice.
    const match =
      body.override === 'inherit'
        ? await evaluate(row, checkedRules(current.analysis_rules), 'inherit')
        : null;
    let result = await rpc('private_mail_filter_override', {
      p_box: TARGET.mailbox_id,
      p_message: row.id,
      p_override: body.override,
      p_confirm: confirm,
    });
    if (match)
      result = await rpc('private_mail_filter_apply', {
        p_box: TARGET.mailbox_id,
        p_message: row.id,
        p_match: match,
        p_confirm: confirm,
      });
    return json({ saved: true, id: row.id, ...result });
  }
  if (action === 'private-mail-filter-apply-preview') {
    if (
      !Array.isArray(body.ids) ||
      body.ids.length < 1 ||
      body.ids.length > 20 ||
      body.ids.some((id) => !UUID.test(id ?? '')) ||
      new Set(body.ids.map((id) => id.toLowerCase())).size !== body.ids.length
    )
      throw fail('MAIL_FILTER_SELECTION_INVALID', 400);
    const rules = checkedRules(current.analysis_rules),
      results = [],
      unresolved = [];
    for (const id of body.ids) {
      if (remaining() <= 0) {
        unresolved.push({ id, code: 'MAIL_FILTER_TIMEOUT' });
        continue;
      }
      try {
        const row = await one(id),
          match = await evaluate(row, rules);
        if (remaining() <= 0) throw fail('MAIL_FILTER_TIMEOUT', 408);
        const result = await rpc('private_mail_filter_apply', {
          p_box: TARGET.mailbox_id,
          p_message: row.id,
          p_match: match,
          p_confirm: confirm,
        });
        results.push({ id: row.id, ...result });
      } catch (error) {
        unresolved.push({ id, code: failureCode(error) });
      }
    }
    return json({ results, scanned: body.ids.length, unresolved });
  }
  const parts = typeof body.ref === 'string' ? body.ref.split(':') : [];
  if (
    parts.length !== 3 ||
    !UUID.test(parts[0]) ||
    !['tasks', 'imageTasks'].includes(parts[1]) ||
    !/^(0|[1-9][0-9]{0,3})$/.test(parts[2]) ||
    typeof body.done !== 'boolean' ||
    !validDay(body.day)
  )
    throw fail('MAIL_ITEM_INVALID', 400);
  await one(parts[0]);
  const saved = await rpc('private_mail_item_override', {
    p_box: TARGET.mailbox_id,
    p_message: parts[0].toLowerCase(),
    p_ref: parts[0].toLowerCase() + ':' + parts[1] + ':' + parts[2],
    p_done: body.done,
    p_day: body.day,
  });
  if (!saved) throw fail('MAIL_ITEM_NOT_FOUND', 409);
  return json({ saved: true, ref: body.ref, done: body.done, day: body.day });
}
