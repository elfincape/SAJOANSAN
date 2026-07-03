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
    const baseURL = String(body.baseURL || DEFAULT_BASE_URL).replace(/\/$/, '');
    const model = body.model || DEFAULT_MODEL;
    const mediaType = body.mediaType || 'image/png';
    const imageBase64 = body.imageBase64 || body.base64;
    const prompt = body.prompt;

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
      const data = await postJson(anthropicURL, {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      }, anthropicPayload);
      return json({ text: extractText(data), provider: 'anthropic_messages', raw: data });
    } catch (err) {
      console.warn('[coupang-vision] messages failed, trying chat fallback', err);
    }

    const rootURL = baseURL.replace(/\/v1$/, '');
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
    const data = await postJson(`${rootURL}/v1/chat/completions`, {
      authorization: `Bearer ${apiKey}`
    }, chatPayload);
    return json({ text: extractText(data), provider: 'chat_completions', raw: data });
  } catch (err) {
    return json({ error: err?.message || String(err) }, 500);
  }
});

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message || data?.message || `${res.status} ${res.statusText}`);
  return data;
}

function extractText(data: any) {
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
