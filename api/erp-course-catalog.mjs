const queryKeys = new Set(['kind', 'center', 'id', 'q', 'after', 'workspaces', 'unlinked']);
const reply = (code, status) =>
  Response.json({ code }, { status, headers: { 'Cache-Control': 'no-store' } });

export default {
  async fetch(request) {
    if (request.method !== 'GET') return reply('METHOD_NOT_ALLOWED', 405);
    const authorization = request.headers.get('authorization');
    if (!/^Bearer [A-Za-z0-9._-]{1,6000}$/.test(authorization ?? ''))
      return reply('UNAUTHENTICATED', 401);
    try {
      const upstream = new URL(process.env.ERP_COURSE_CATALOG_URL ?? '');
      if (upstream.protocol !== 'https:' || upstream.pathname !== '/' ||
          upstream.username || upstream.password || upstream.search || upstream.hash)
        return reply('CATALOG_NOT_CONFIGURED', 503);
      upstream.pathname = '/api/course-catalog';
      const params = new URL(request.url).searchParams;
      for (const [key, value] of params) {
        if (!queryKeys.has(key) || upstream.searchParams.has(key) || value.length > 120)
          return reply('INVALID_FIELD', 400);
        upstream.searchParams.set(key, value);
      }
      const result = await fetch(upstream, {
        headers: { Authorization: authorization, Accept: 'application/json' },
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
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
