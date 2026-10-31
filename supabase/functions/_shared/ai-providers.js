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
    diagnosticCapabilities: diagnosticCapabilities(provider, id),
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
  if (
    (provider === 'aiapiflow' && id === 'gpt-5.6-luna') ||
    (provider === 'openai' && id === 'gpt-6-luna')
  )
    return {
      protocol: 'responses',
      images: true,
      structured: provider === 'openai' ? 'json_object' : 'json_schema',
      verification: 'protocol_only',
    };
  if (provider === 'aiapiflow' && id === 'claude-haiku-4-5-20251001')
    return {
      protocol: 'anthropic',
      images: true,
      structured: 'prompt_and_validation',
      verification: 'protocol_only',
    };
  return null;
}
// Protocol candidates may be tested without becoming selectable production defaults.
export function diagnosticCapabilities(provider, id) {
  const known = modelCapabilities(provider, id);
  if (known) return known;
  if (!Object.hasOwn(AI_PROVIDERS, provider) || typeof id !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(id) ||
      /embedding|tts|whisper|dall-e|sora|moderation|audio|realtime|transcrib|image/i.test(id)) return null;
  if (provider === 'aiapiflow' && /^claude-/i.test(id))
    return {protocol:'anthropic',images:true,structured:'prompt_and_validation',verification:'unverified'};
  if (/^(?:gpt-|o[1-9](?:-|$)|chatgpt-)/i.test(id))
    return {protocol:'responses',images:true,structured:'json_object',verification:'unverified'};
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
export async function verifyApiCompatibility(body, env, fetcher = fetch) {
  if (body.confirmation !== 'synthetic-compatibility')
    throw coded('AI_VERIFICATION_CONFIRMATION_REQUIRED');
  if (body.provider === 'typesafe') {
    if (body.model !== 'jev-1.14.0') throw coded('AI_MODEL_UNSUPPORTED');
    if (!env.TYPESAFE_API_KEY) throw coded('AI_NOT_CONFIGURED', 409);
    const { verifyMailExtraction } =
      await import('../onedrive-auth/private-mail-jev-verifier.js');
    let providerStatus = null;
    const result = await verifyMailExtraction({
      source: '가상센터 4P 배차. 차량 톤수는 명시하지 않음.',
      items: [{ id: 'wrong_tons', text: '4톤 차량 배차' }],
      key: env.TYPESAFE_API_KEY,
      timeoutMs: 6000,
      fetcher: async (...args) => {
        const response = await fetcher(...args);
        providerStatus = response.status;
        return response;
      },
    });
    const probability = result.findings?.find(
      (item) => item.id === 'wrong_tons',
    )?.unsupportedProbability;
    const reviewRequired = result.reviewIds?.includes('wrong_tons') === true;
    const passed =
      result.model === body.model &&
      typeof probability === 'number' &&
      probability >= 0.3 &&
      reviewRequired;
    const status = passed
      ? 'passed'
      : providerStatus === 401 || providerStatus === 403
        ? 'auth'
        : providerStatus === 404
          ? 'model_missing'
          : providerStatus === 400 || providerStatus === 422
            ? 'unsupported'
            : ['TIMEOUT', 'NETWORK', 'RATE_LIMIT', 'HTTP_FAILED'].includes(
                  result.code,
                )
              ? 'transient'
              : 'invalid_response';
    return {
      provider: body.provider,
      model: body.model,
      protocol: 'systemone',
      checkedAt: new Date().toISOString(),
      passed,
      checks: [
        {
          kind: 'judgment',
          status,
          returnedModel: result.model,
          stopReason: result.status,
          usage: result.usage,
          providerStatus,
          diagnosticCode: result.code ?? null,
          unsupportedProbability: probability,
          reviewRequired,
        },
      ],
    };
  }
  const capabilities = diagnosticCapabilities(body.provider, body.model);
  if (!Object.hasOwn(AI_PROVIDERS, body.provider) || typeof body.model !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(body.model)) throw coded('AI_MODEL_UNSUPPORTED');
  if (!capabilities) return {provider:body.provider,model:body.model,protocol:'unsupported',checkedAt:new Date().toISOString(),passed:false,checks:[{kind:'protocol',status:'unsupported',diagnosticCode:'ADAPTER_NOT_IMPLEMENTED',providerStatus:null}]};
  const key = env[AI_PROVIDERS[body.provider].secret];
  if (!key) throw coded('AI_NOT_CONFIGURED', 409);
  const { callLuna } = await import('./luna.js');
  // Public synthetic fixture: app/public/diagnostics/mail-body-fixture.png (480 x 160).
  const fixture =
    'iVBORw0KGgoAAAANSUhEUgAAAeAAAACgAQAAAAD8gILgAAADuklEQVR42u2Zz2skRRTHP1XTZHohMo0oTCAwrXjwJCMIxkumAwu7R/8Dc/S4HsRVYqYNIe5tB7yKzr+wtxzCbmfJIYKYuXlZ3N5lYebgoYcMbvfY3eUh86MTRao6CiL9TvOa+UxVvXqv37dqhKK8SSq4gv+3sHWa9Eai5vfFu+LtzMnEDZm0hK0FZ/l6Ei/8SQwwijRHTlNHQppC5+wsOP+1dj7Oh88Kv/d3sJArk3Thv7ABbEc7YCpcfte2DKNt2SsLf2AWbeXLD68+nWjSKq3nrW+HaU6L7tnwe6XO41rYSZSGSWpT4V79xeZAd80vQfrQ9Tv+xTOR1g+1M+wvHrsGuS2Cud8uURjh3I9TI3iaAv7cX48BBqHuPt+Yfz724JXXQMnxbU14ZQXw5v6qDdDWW7qoGl0FV3AF/zfg6agUnBW8zB377CtHl1apUkqpZKiUUnEj6CiR1pWeLRpVEyA5tEP1fvqkVMCkO/C5KXSnbQHj+/u/uz89GNaTj1eJ8r1PDwxGjh7l+YhR8AUAfbOtGoYv05DG040y+3z6iZU4OLs3gbZvCDueJW1gDxizbZhhhWbXDkzTM99Z+A3z3C4sdGAIR0Gax8AuqxOQuwdTA3ijd7cegTwiD8N+/0hF+rBYe7NnuSBOqd9+hvjBestkq7ZWZRM4wHLcgD1pa5fk0vKuMrNiVeWm6VlQQ2pavwZcy8u/PYW8xrSrdlPBFfwPwpNyskSSLU9kAJl3DPcSu9S0JwSe8s3X3ASo0QrZFjrXJH8+ea+yjdAc2QKyk/b4vvzyQpaYNnc2iYLuJVmiXG34M4bhzs5ClvSBkTa8z+mdvYUsGXtQCwyi7Xh7C1lCsI21brRVy0A1tgHHBFabBVFjXBheucLoAlGQz2TJzCI9WD70YKN3NJMlEAR94hd6sDjxYe2N05ksGZ8c99Ta555men4FON6tuAkcJOApsJummsRYllypZzNtcLm5G8qSK7CZLLk8bUNZUmmSCq7gfxHul4EfF/3esWcEz67y+8oH/OU9uQ6sNmft9OLI3rhjAudbhbGUZ9K0LPBb3fybnz94nn2N+5FvFrCMNmk8jUAE/bzEVtWe1A6/k3e5dEWlC1uO5QJPkRCYwtmFivC9mHHPFE6XylPzn5cCnFwIgXf85L2G0bRrDMqWhwTfn0uQ12n9aAbLR+7DPCw5sni8dVL34Dn3TGELgk79tzZ4v/CqKa1UutAh5+b3JLJwvjCOtgjKvsMuKQMnKv0CvObIVbup4Aqu4FL2B6tHQcCfFVUfAAAAAElFTkSuQmCC';
  const checks = [];
  for (const kind of ['text', 'image', 'json']) {
    let providerStatus = null;
    try {
      const response = await callLuna({
        provider: body.provider,
        model: body.model,
        diagnostic: true,
        key,
        fetcher: async (...args) => {
          const response = await fetcher(...args);
          providerStatus = response.status;
          return response;
        },
        prompt:
          kind === 'json'
            ? 'Return exactly the JSON object {"ok":true}.'
            : kind === 'image'
              ? 'Read the attached image. Return only the numeric quantity of pallets shown in the image, without the unit or any other text.'
              : 'Return exactly OK, with no other text.',
        maxTokens: 1024,
        timeoutMs: 20000,
        ...(kind === 'image'
          ? { images: [{ mediaType: 'image/png', data: fixture }] }
          : {}),
        ...(kind === 'json'
          ? {
              schemaName: 'compatibility_check',
              schema: {
                type: 'object',
                properties: { ok: { type: 'boolean' } },
                required: ['ok'],
                additionalProperties: false,
              },
            }
          : {}),
      });
      const text = response.content[0].text.trim();
      let valid = text === (kind === 'image' ? '4' : 'OK');
      if (kind === 'json') {
        try {
          const value = JSON.parse(text);
          valid = value?.ok === true && Object.keys(value).length === 1;
        } catch {
          valid = false;
        }
      }
      const status =
        response.model !== body.model
          ? 'model_mismatch'
          : valid
            ? 'passed'
            : 'invalid_response';
      checks.push({
        kind,
        status,
        returnedModel: response.model,
        stopReason: response.stop_reason,
        usage: response.usage,
        providerStatus,
      });
      if (status !== 'passed') break;
    } catch (error) {
      const status = error?.providerStatus;
      checks.push({
        kind,
        providerStatus: status ?? providerStatus,
        diagnosticCode: error?.code ?? 'REQUEST_FAILED',
        retryAfterSeconds: error?.retryAfterSeconds ?? null,
        responseReason: error?.reason ?? null,
        responseShape: error?.modelResponseShape ?? null,
        status:
          status === 401 || status === 403
            ? 'auth'
            : status === 404
              ? 'model_missing'
              : status === 400 || status === 422
                ? 'unsupported'
                : status === 429 ||
                    status >= 500 ||
                    error?.reason === 'timeout' ||
                    error?.reason === 'network' ||
                    ['AbortError', 'TimeoutError', 'TypeError'].includes(
                      error?.name,
                    )
                  ? 'transient'
                  : 'invalid_response',
      });
      // Stop after a failure; never retry or switch providers/models.
      break;
    }
  }
  return {
    provider: body.provider,
    model: body.model,
    protocol: capabilities.protocol,
    checkedAt: new Date().toISOString(),
    passed:
      checks.length === 3 && checks.every((check) => check.status === 'passed'),
    checks,
  };
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
  if (action === 'api-admin-verify')
    return json(await verifyApiCompatibility(body, env, fetcher));
  const config =
    (await db('onedrive_settings?select=ai_defaults&id=eq.true'))[0]
      ?.ai_defaults ?? {};
  if (action === 'api-admin-status')
    return json({
      scope: 'daily-briefing',
      judgment: {
        provider: 'typesafe',
        keyConfigured: Boolean(env.TYPESAFE_API_KEY),
        liveVerified: false,
      },
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
