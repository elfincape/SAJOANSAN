const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

const DEFAULT_BASE_URL = 'https://aiapiflow.com/v1';
const DEFAULT_MODEL = 'claude-haiku-4-5';
const FALLBACK_API_KEY = 'sk-d518e242674b4b1ac63b3594bde3643cad68c8d76e95f64914b35a6020e8212f';

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const body = await req.json();
    const apiKey = Deno.env.get('AIAPIFLOW_API_KEY') || body.apiKey || FALLBACK_API_KEY;
    const baseURL = normalizeApiBaseURL(body.baseURL || DEFAULT_BASE_URL);
    const model = body.model || DEFAULT_MODEL;
    const mediaType = body.mediaType || 'image/png';
    const imageBase64 = body.imageBase64 || body.base64;
    const prompt = body.prompt;

    console.log('[coupang-vision] request received', {
      baseURL,
      model,
      mediaType,
      hasImage: Boolean(imageBase64),
      promptLength: String(prompt || '').length
    });

    if (!imageBase64) return json({ error: 'imageBase64 is required' }, 400);
    if (!prompt) return json({ error: 'prompt is required' }, 400);

    const anthropicURL = `${baseURL}/messages`;
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

    try {
      const result = await postJson(anthropicURL, {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }, anthropicPayload);
      const text = extractText(result.data);
      console.log('[coupang-vision] parsed provider=anthropic_messages text:', text);
      return json({ text, provider: 'anthropic_messages', status: result.status, requestURL: result.url, rawBody: result.bodyText, raw: result.data });
    } catch (err) {
      console.warn('[coupang-vision] messages failed, trying chat fallback', err);
      console.warn('[coupang-vision] messages stack:', errorStack(err));
    }

    const rootURL = baseURL.replace(/\/v1$/, '');
    const chatURL = `${rootURL}/v1/chat/completions`;
    const chatPayload = {
      model,
      temperature: 0,
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } }
        ]
      }]
    };
    const result = await postJson(chatURL, {
      authorization: `Bearer ${apiKey}`
    }, chatPayload);
    const text = extractText(result.data);
    console.log('[coupang-vision] parsed provider=chat_completions text:', text);
    return json({ text, provider: 'chat_completions', status: result.status, requestURL: result.url, rawBody: result.bodyText, raw: result.data });
  } catch (err) {
    console.error('[coupang-vision] fatal error:', err);
    console.error('[coupang-vision] stack:', errorStack(err));
    return json({ error: errorMessage(err), stack: errorStack(err) }, 500);
  }
});

function normalizeApiBaseURL(value: unknown) {
  const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/$/, '');
  return raw.endsWith('/v1') ? raw : `${raw}/v1`;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  console.log('[coupang-vision] request URL:', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const bodyText = await res.text();
  console.log('[coupang-vision] HTTP Status:', res.status, res.statusText);
  console.log('[coupang-vision] Claude raw response body:', bodyText);
  let data: any = null;
  try { data = bodyText ? JSON.parse(bodyText) : null; }
  catch (err) {
    console.error('[coupang-vision] response JSON.parse failed:', err);
    console.error('[coupang-vision] response JSON.parse stack:', errorStack(err));
  }
  if (!res.ok) throw new Error(data?.error?.message || data?.message || bodyText || `${res.status} ${res.statusText}`);
  return { data, status: res.status, url, bodyText };
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function errorStack(err: unknown) {
  return err instanceof Error ? err.stack || '(stack 없음)' : '(stack 없음)';
}

function extractText(data: any) {
  console.log('[coupang-vision] Claude parsed JSON:', data);
  if (Array.isArray(data?.content)) return data.content.map((part: any) => part.text || '').join('\n').trim();
  if (data?.choices?.[0]?.message?.content) return String(data.choices[0].message.content).trim();
  if (data?.output_text) return String(data.output_text).trim();
  return JSON.stringify(data);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json; charset=utf-8' }
  });
}
