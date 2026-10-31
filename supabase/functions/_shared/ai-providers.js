export const AI_PROVIDERS = Object.freeze({
  aiapiflow: {
    label: 'AIAPIFlow',
    secret: 'AIAPIFLOW_API_KEY',
    modelsUrl: 'https://aiapiflow.com/v1/models',
    defaultModel: 'gpt-5.6-luna',
  },
  openai: {
    label: 'OpenAI 공식',
    secret: 'OPENAI_API_KEY',
    modelsUrl: 'https://api.openai.com/v1/models',
    defaultModel: 'gpt-6-luna',
  },
});
const coded = (code, status = 400) =>
  Object.assign(Error(code), { code, status });
function catalogModel(provider, id, available) {
  const capabilities = modelCapabilities(provider, id);
  return {
    id,
    available,
    capabilities,
    support: capabilities
      ? 'supported'
      : /embedding|tts|whisper|dall-e|sora|moderation|audio|realtime|transcrib|image/i.test(
            id,
          )
        ? 'unsupported'
        : 'unknown',
  };
}
export function modelCapabilities(provider, id) {
  if (
    !Object.hasOwn(AI_PROVIDERS, provider) ||
    typeof id !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(id)
  )
    return null;
  if (
    /audio|realtime|transcrib|embedding|(?:^|-)tts(?:-|$)|image|moderation/i.test(
      id,
    )
  )
    return null;
  if (/^gpt-(?:4\.1|4o|5|6)(?:[.-]|$)/.test(id))
    return {
      protocol: 'responses',
      images: true,
      structured: 'json_schema',
      verification: 'protocol_only',
    };
  if (
    provider === 'aiapiflow' &&
    /^claude-(?:haiku|sonnet|opus|[3-6])/.test(id)
  )
    return {
      protocol: 'anthropic',
      images: true,
      structured: 'prompt_and_validation',
      verification: 'protocol_only',
    };
  return null;
}
export async function providerModels(provider, env, fetcher = fetch) {
  const definition = AI_PROVIDERS[provider];
  if (!Object.hasOwn(AI_PROVIDERS, provider))
    throw coded('AI_PROVIDER_INVALID');
  const key = env[definition.secret];
  const base = {
    id: provider,
    label: definition.label,
    secretName: definition.secret,
    keyConfigured: !!key,
    maskedKey: key ? '••••••••' : '',
    liveVerified: false,
  };
  if (!key)
    return {
      ...base,
      catalogStatus: 'not_configured',
      models: [catalogModel(provider, definition.defaultModel, false)],
    };
  try {
    const response = await fetcher(definition.modelsUrl, {
      headers: { authorization: 'Bearer ' + key },
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        ...base,
        catalogStatus:
          response.status === 401 || response.status === 403
            ? 'access_denied'
            : 'unavailable',
        models: [],
      };
    }
    const reader = response.body?.getReader();
    if (!reader) throw coded('AI_CATALOG_INVALID');
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1048576) throw coded('AI_CATALOG_LIMIT');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value = JSON.parse(new TextDecoder().decode(buffer));
    if (!Array.isArray(value.data) || value.data.length > 5000)
      throw coded('AI_CATALOG_INVALID');
    const ids = [
      ...new Set(
        value.data
          .map((item) => item?.id)
          .filter(
            (id) =>
              typeof id === 'string' &&
              /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(id),
          ),
      ),
    ].sort();
    return {
      ...base,
      catalogStatus: 'ready',
      models: ids.map((id) => catalogModel(provider, id, true)),
    };
  } catch {
    return { ...base, catalogStatus: 'unavailable', models: [] };
  }
}
export async function handleApiManagement(
  action,
  body,
  user,
  { db, env, fetcher = fetch, json },
) {
  if (user.role !== 'admin') throw coded('ADMIN_REQUIRED', 403);
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw coded('AI_CONFIG_INVALID');
  const config =
    (await db('onedrive_settings?select=ai_defaults&id=eq.true'))[0]
      ?.ai_defaults ?? {};
  if (action === 'api-admin-status')
    return json({
      scope: 'daily-briefing',
      default: config.provider
        ? config
        : {
            provider:
              env.PRIVATE_MAIL_AI_PROVIDER === 'openai'
                ? 'openai'
                : 'aiapiflow',
            model:
              env.PRIVATE_MAIL_AI_PROVIDER === 'openai'
                ? 'gpt-6-luna'
                : 'gpt-5.6-luna',
            revision: 0,
          },
      providers: await Promise.all(
        Object.keys(AI_PROVIDERS).map((id) => providerModels(id, env, fetcher)),
      ),
    });
  if (
    action !== 'api-admin-default' ||
    !Number.isSafeInteger(body.revision) ||
    body.revision < 0
  )
    throw coded('AI_CONFIG_INVALID');
  const capabilities = modelCapabilities(body.provider, body.model);
  if (!capabilities) throw coded('AI_MODEL_UNSUPPORTED');
  const catalog = await providerModels(body.provider, env, fetcher);
  if (!catalog.keyConfigured) throw coded('AI_NOT_CONFIGURED', 409);
  if (catalog.catalogStatus !== 'ready')
    throw coded('AI_CATALOG_UNAVAILABLE', 409);
  if (
    !catalog.models.some((model) => model.id === body.model && model.available)
  )
    throw coded('AI_MODEL_UNAVAILABLE', 409);
  const saved = await db('rpc/onedrive_ai_default_save', {
    method: 'POST',
    body: {
      p_user: user.id,
      p_revision: body.revision,
      p_provider: body.provider,
      p_model: body.model,
      p_protocol: capabilities.protocol,
    },
  });
  return json({ saved: true, default: saved });
}
