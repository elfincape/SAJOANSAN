export const OWNER_ID = '2a828c2d-9a6f-40d4-8e13-336b591811cc';
const HOST = 'mail.onnet21.com',
  PORT = 995,
  SITE = 'https://sajoansan.vercel.app';
const LOCK = 'private-mail-pop-diagnostic';

async function bounded(promise, ms, code) {
  let timer,
    timedOut = false;
  const observed = Promise.resolve(promise).then((value) => {
    if (timedOut) {
      try {
        value?.close?.();
      } catch {}
    }
    return value;
  });
  try {
    return await Promise.race([
      observed,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          reject(Object.assign(new Error(code), { code }));
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function probePopConnection(network, { timeoutMs = 3000 } = {}) {
  const stages = {
    dns: 'pending',
    tcp: 'pending',
    tls: 'pending',
    greeting: 'pending',
  };
  let stage = 'dns',
    tcp,
    tls;
  const started = Date.now();
  try {
    const addresses = await bounded(
      network.resolveDns(HOST, 'A'),
      timeoutMs,
      'DNS_TIMEOUT',
    );
    if (!addresses?.length) throw Error('DNS_FAILED');
    stages.dns = 'ok';
    stage = 'tcp';
    tcp = await bounded(
      network.connect({ hostname: HOST, port: PORT, transport: 'tcp' }),
      timeoutMs,
      'TCP_TIMEOUT',
    );
    stages.tcp = 'ok';
    stage = 'tls';
    tls = await bounded(
      network.startTls(tcp, { hostname: HOST }),
      timeoutMs,
      'TLS_TIMEOUT',
    );
    await bounded(tls.handshake(), timeoutMs, 'TLS_TIMEOUT');
    stages.tls = 'ok';
    stage = 'greeting';
    const bytes = new Uint8Array(512);
    let length = 0;
    const line = async () => {
      while (length < bytes.length) {
        const count = await tls.read(bytes.subarray(length));
        if (count === null) break;
        if (!Number.isInteger(count) || count <= 0)
          throw Error('POP_GREETING_FAILED');
        length += count;
        const newline = bytes.subarray(0, length).indexOf(10);
        if (newline >= 0)
          return new TextDecoder().decode(bytes.subarray(0, newline + 1));
      }
      throw Error('POP_GREETING_FAILED');
    };
    const greeting = await bounded(line(), timeoutMs, 'GREETING_TIMEOUT');
    if (!/^\+OK(?:[ \r\n]|$)/.test(greeting))
      throw Error('POP_GREETING_FAILED');
    stages.greeting = 'ok';
    return {
      ok: true,
      target: HOST + ':' + PORT,
      stages,
      elapsed_ms: Date.now() - started,
      checked_at: new Date().toISOString(),
    };
  } catch (error) {
    stages[stage] = 'failed';
    const code = error.code?.endsWith('_TIMEOUT')
      ? error.code
      : {
          dns: 'DNS_FAILED',
          tcp: 'TCP_FAILED',
          tls: 'TLS_FAILED',
          greeting: 'POP_GREETING_FAILED',
        }[stage];
    return {
      ok: false,
      target: HOST + ':' + PORT,
      stages,
      code,
      elapsed_ms: Date.now() - started,
      checked_at: new Date().toISOString(),
    };
  } finally {
    try {
      tls?.close();
    } catch {}
    try {
      tcp?.close();
    } catch {}
  }
}

export function makeDiagnosticHandler(
  env,
  network,
  { fetcher = fetch, timeoutMs = 3000 } = {},
) {
  const root = env.SUPABASE_URL,
    anon = env.SUPABASE_ANON_KEY,
    service = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = {
    'Access-Control-Allow-Origin': SITE,
    'Access-Control-Allow-Headers':
      'authorization,apikey,content-type,x-client-info',
    'Access-Control-Allow-Methods': 'POST,OPTIONS',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    'Content-Type': 'application/json',
  };
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), { status, headers });
  async function getUser(token) {
    const result = await fetcher(root + '/auth/v1/user', {
      headers: { apikey: anon, Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(5000),
    });
    return result.ok ? result.json() : null;
  }
  async function lockRequest(path, method, body) {
    const response = await fetcher(root + '/rest/v1/onedrive_locks?' + path, {
      method,
      headers: {
        apikey: service,
        Authorization: 'Bearer ' + service,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw Error('LOCK_UNAVAILABLE');
    const text = await response.text();
    return text ? JSON.parse(text) : [];
  }
  return async (req) => {
    const origin = req.headers.get('origin');
    if (origin && origin !== SITE)
      return json({ error: '허용되지 않은 출처입니다.' }, 403);
    if (req.method === 'OPTIONS')
      return new Response(null, { status: 204, headers });
    if (req.method !== 'POST')
      return json({ error: 'POST 요청이 필요합니다.' }, 405);
    const token = req.headers
      .get('authorization')
      ?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return json({ error: '로그인이 필요합니다.' }, 401);
    let holder;
    try {
      if (!root || !anon || !service)
        return json({ error: '진단 서버 설정을 확인해 주세요.' }, 503);
      const user = await getUser(token);
      if (!user) return json({ error: '다시 로그인해 주세요.' }, 401);
      if (user.id !== OWNER_ID)
        return json({ error: '본인 전용 진단입니다.' }, 403);
      const profile = await fetcher(
        root + '/rest/v1/user_profiles?select=id,active&id=eq.' + OWNER_ID,
        {
          headers: { apikey: anon, Authorization: 'Bearer ' + token },
          signal: AbortSignal.timeout(5000),
        },
      );
      if (!profile.ok)
        return json({ error: '계정 상태를 확인할 수 없습니다.' }, 403);
      const rows = await profile.json();
      if (!rows.some((p) => p.id === OWNER_ID && p.active === true))
        return json({ error: '활성 본인 계정만 사용할 수 있습니다.' }, 403);
      await lockRequest(
        'name=eq.' +
          LOCK +
          '&expires_at=lt.' +
          encodeURIComponent(new Date().toISOString()),
        'DELETE',
      );
      const candidate = crypto.randomUUID();
      const acquired = await lockRequest('on_conflict=name', 'POST', {
        name: LOCK,
        holder: candidate,
        expires_at: new Date(Date.now() + 45000).toISOString(),
      });
      if (!acquired.length)
        return json(
          {
            error:
              '다른 연결 진단이 실행 중입니다. 잠시 후 다시 시도해 주세요.',
          },
          409,
        );
      holder = candidate;
      // Never read input targets or send POP commands. A successful greeting is the end.
      return json(await probePopConnection(network, { timeoutMs }));
    } catch {
      return json(
        {
          error: '연결 진단을 실행하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        },
        503,
      );
    } finally {
      if (holder)
        await lockRequest(
          'name=eq.' + LOCK + '&holder=eq.' + holder,
          'DELETE',
        ).catch(() => {});
    }
  };
}
