const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fields = ['subject', 'body', 'sender', 'domain'];
const normalize = (value) => value.normalize('NFKC').toLowerCase();
function invalid() {
  throw Error('MAIL_RULE_INVALID');
}
function domain(value) {
  if (typeof value !== 'string') return null;
  const input = normalize(value.trim());
  if (!input || /[\s/@:#?\\]/u.test(input) || input.endsWith('.')) return null;
  let result;
  try {
    result = new URL('https://' + input).hostname;
  } catch {
    return null;
  }
  return result.length <= 253 &&
    result
      .split('.')
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    ? result
    : null;
}
function address(value, display = false) {
  if (typeof value !== 'string') return null;
  let input = normalize(value.trim());
  if (display) {
    const match = /^(?:[^<>]*<([^<>]+)>|([^<>]+))$/.exec(input);
    if (!match) return null;
    input = (match[1] ?? match[2]).trim();
  }
  const match = /^([a-z0-9.!#$%&'*+/=?^_`{|}~-]+)@([^@]+)$/.exec(input);
  const host = match && domain(match[2]);
  return host && match[1].length <= 64 ? match[1] + '@' + host : null;
}
export function validateMailRule(rule) {
  if (
    !rule ||
    typeof rule !== 'object' ||
    Array.isArray(rule) ||
    !UUID.test(rule.id ?? '') ||
    typeof rule.name !== 'string' ||
    !rule.name.trim() ||
    rule.name.trim().length > 100 ||
    typeof rule.enabled !== 'boolean' ||
    !['all', 'any'].includes(rule.mode) ||
    !Array.isArray(rule.conditions) ||
    rule.conditions.length < 1 ||
    rule.conditions.length > 10
  )
    invalid();
  const conditions = rule.conditions.map((condition) => {
    if (
      !condition ||
      !fields.includes(condition.field) ||
      typeof condition.value !== 'string' ||
      !condition.value.trim() ||
      condition.value.length > 500
    )
      invalid();
    let value = normalize(condition.value.trim());
    if (condition.field === 'sender') value = address(value);
    if (condition.field === 'domain') value = domain(value);
    if (!value) invalid();
    return { field: condition.field, value };
  });
  return {
    id: rule.id.toLowerCase(),
    name: rule.name.trim(),
    enabled: rule.enabled,
    mode: rule.mode,
    conditions,
  };
}
export function matchMailRules({ mail, rules, override = 'inherit' }) {
  if (
    !mail ||
    typeof mail !== 'object' ||
    Array.isArray(mail) ||
    !['inherit', 'include', 'exclude'].includes(override)
  )
    invalid();
  if (!Array.isArray(rules) || rules.length > 50)
    throw Error('MAIL_RULE_LIMIT');
  const checked = rules.map(validateMailRule);
  if (new Set(checked.map((rule) => rule.id)).size !== checked.length)
    invalid();
  const result = {
    excluded: false,
    reason: null,
    ruleId: null,
    ruleName: null,
    matchedFields: [],
  };
  if (override === 'include') return { ...result, reason: 'MANUAL_INCLUDE' };
  if (override === 'exclude')
    return { ...result, excluded: true, reason: 'MANUAL_EXCLUDE' };
  const sender = address(mail.sender, true);
  const values = {
    subject: typeof mail.subject === 'string' ? normalize(mail.subject) : null,
    body:
      typeof (mail.text ?? mail.body) === 'string'
        ? normalize(mail.text ?? mail.body)
        : null,
    sender,
    domain: sender ? sender.slice(sender.lastIndexOf('@') + 1) : null,
  };
  for (const rule of checked) {
    if (!rule.enabled) continue;
    // Missing body text cannot establish a safe non-match for a local body filter.
    if (
      rule.conditions.some((condition) => condition.field === 'body') &&
      values.body === null
    )
      throw Error('MAIL_FILTER_BODY_REQUIRED');
    const matches = rule.conditions.map(
      ({ field, value }) =>
        values[field] !== null &&
        (field === 'sender' || field === 'domain'
          ? values[field] === value
          : values[field].includes(value)),
    );
    if (rule.mode === 'all' ? matches.every(Boolean) : matches.some(Boolean))
      return {
        ...result,
        excluded: true,
        reason: 'RULE_MATCH',
        ruleId: rule.id,
        ruleName: rule.name,
        matchedFields: [
          ...new Set(
            rule.conditions
              .filter((_, index) => matches[index])
              .map(({ field }) => field),
          ),
        ],
      };
  }
  return result;
}
