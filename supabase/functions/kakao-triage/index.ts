import { makeHandler } from '../onedrive-auth/handler.js';

const triage = makeHandler(Deno.env.toObject());
Deno.serve((request: Request) => {
  const { pathname, search } = new URL(request.url);
  if (search || !/^(?:\/functions\/v1)?\/kakao-triage\/?$/.test(pathname)) {
    return new Response(null, { status: 404 });
  }
  return triage(request);
});
