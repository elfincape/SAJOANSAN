const queryKeys = new Set(['kind', 'center', 'id', 'q', 'after', 'workspaces', 'unlinked']);
const reply = (code, status) =>
  Response.json({ code }, { status, headers: { 'Cache-Control': 'no-store' } });

export default {
  async fetch(request) {
    const write = request.method === 'POST';
    if (request.method !== 'GET' && !write) return reply('METHOD_NOT_ALLOWED', 405);
    if (write && request.headers.get('content-type') !== 'application/json')
      return reply('INVALID_FIELD', 415);
    const authorization = request.headers.get('authorization');
    if (!/^Bearer [A-Za-z0-9._-]{1,6000}$/.test(authorization ?? ''))
      return reply('UNAUTHENTICATED', 401);
    try {
      const upstream = new URL(process.env.ERP_COURSE_CATALOG_URL ?? '');
      if (upstream.protocol !== 'https:' || upstream.pathname !== '/' ||
          upstream.username || upstream.password || upstream.search || upstream.hash)
        return reply('CATALOG_NOT_CONFIGURED', 503);
      upstream.pathname = write ? '/api/course-catalog/dispatch-profiles' : '/api/course-catalog';
      const params = new URL(request.url).searchParams;
      for (const [key, value] of params) {
        if (write || !queryKeys.has(key) || upstream.searchParams.has(key) || value.length > 120)
          return reply('INVALID_FIELD', 400);
        upstream.searchParams.set(key, value);
      }
      const body = write ? await request.arrayBuffer() : undefined;
      if (body && body.byteLength > 4 * 1024 * 1024)
        return reply('BATCH_TOO_LARGE', 413);
      const result = await fetch(upstream, {
        method: request.method,
        body,
        headers: {
          Authorization: authorization,
          Accept: 'application/json',
          ...(write ? { 'Content-Type': 'application/json' } : {}),
        },
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(write ? 50000 : 20000),
      });
      return new Response(result.body, {
        status: result.status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    } catch {
      return reply('CATALOG_UNAVAILABLE', 503);
    }
  },
};
