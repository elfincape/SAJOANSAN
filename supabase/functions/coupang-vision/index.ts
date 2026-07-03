const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const AIAPIFLOW_BASE_URL = 'https://aiapiflow.com/v1';
const MODEL = 'claude-haiku-4-5-20251001';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return json({ ok: true });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await safeReadJson(req);
    const apiKey = Deno.env.get('AIAPIFLOW_API_KEY');
    const mediaType = body.mediaType || 'image/png';
    const imageBase64 = body.imageBase64 || body.base64;
    const prompt = body.prompt;
    const model = body.model || MODEL;

    console.log('[coupang-vision] request received', {
      requestURL: req.url,
      aiapiflowURL: `${AIAPIFLOW_BASE_URL}/messages`,
      model,
      mediaType,
      hasImage: Boolean(imageBase64),
      promptLength: String(prompt || '').length
    });

    if (!apiKey) return json({ error: 'Missing AIAPIFLOW_API_KEY' }, 500);
    if (!imageBase64) return json({ error: 'imageBase64 is required' }, 400);
    if (!prompt) return json({ error: 'prompt is required' }, 400);

    const anthropicURL = `${AIAPIFLOW_BASE_URL}/messages`;
    const anthropicPayload = {
      model,
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: prompt }
        ]
      }]
    };

    const result = await postJson(anthropicURL, {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }, anthropicPayload, model);

    const text = extractText(result.data, result.bodyText);
    console.log('[coupang-vision] Claude parsed text:', text);
    return json({
      text,
      provider: 'anthropic_messages',
      requestURL: result.url,
      status: result.status,
      responseText: result.bodyText,
      aiapiflowResponseText: result.bodyText,
      raw: result.data
    });
  } catch (err) {
    const payload = errorPayload(err);
    console.error('[coupang-vision] fatal error:', payload);
    return json(payload, payload.status || 500);
  }
});

async function safeReadJson(req: Request) {
  try { return await req.json(); }
  catch (err) { throw new AppError('Invalid JSON request body', 400, { stack: errorStack(err) }); }
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, model: string) {
  console.log('[coupang-vision] request URL:', url);
  console.log('[coupang-vision] model:', model);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.error('[coupang-vision] AIAPIFlow fetch failed', { requestURL: url, model, stack: errorStack(err) });
    throw new AppError(`AIAPIFlow fetch failed: ${errorMessage(err)}`, 502, { requestURL: url, model, stack: errorStack(err) });
  }

  const bodyText = await res.text();
  console.log('[coupang-vision] HTTP Status:', res.status, res.statusText);
  console.log('[coupang-vision] Claude raw response body:', bodyText);

  let data: any = null;
  try { data = bodyText ? JSON.parse(bodyText) : null; }
  catch (err) {
    console.error('[coupang-vision] Claude response JSON parse failed', { requestURL: url, model, status: res.status, responseText: bodyText, stack: errorStack(err) });
    throw new AppError(`Claude response JSON parse failed: ${errorMessage(err)}`, 502, {
      requestURL: url,
      model,
      status: res.status,
      responseText: bodyText,
      aiapiflowResponseText: bodyText,
      stack: errorStack(err)
    });
  }

  console.log('[coupang-vision] Claude parsed JSON:', data);
  if (!res.ok) {
    console.error('[coupang-vision] AIAPIFlow request failed', { requestURL: url, model, status: res.status, responseText: bodyText, raw: data });
    throw new AppError(data?.error?.message || data?.message || `AIAPIFlow request failed: ${res.status} ${res.statusText}`, 502, {
      requestURL: url,
      model,
      status: res.status,
      responseText: bodyText,
      aiapiflowResponseText: bodyText,
      raw: data
    });
  }
  return { data, status: res.status, url, bodyText };
}

function extractText(data: any, responseText: string) {
  if (Array.isArray(data?.content)) {
    const text = data.content.map((part: any) => part.text || '').join('\n').trim();
    if (text) return text;
  }
  if (data?.choices?.[0]?.message?.content) return String(data.choices[0].message.content).trim();
  if (data?.output_text) return String(data.output_text).trim();
  throw new AppError('Claude response did not contain text content', 502, { responseText, raw: data });
}

class AppError extends Error {
  status: number;
  details: Record<string, unknown>;
  constructor(message: string, status = 500, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.details = details;
  }
}

function errorPayload(err: unknown) {
  if (err instanceof AppError) {
    return { error: err.message, status: err.status, ...err.details, stack: err.stack || null };
  }
  return { error: errorMessage(err), status: 500, stack: errorStack(err) };
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function errorStack(err: unknown) {
  return err instanceof Error ? err.stack || '(stack 없음)' : '(stack 없음)';
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' }
  });
}
