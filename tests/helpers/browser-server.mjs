import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function startBrowserServer() {
  const root = fileURLToPath(new URL('../../repo-root/', import.meta.url));
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET') {
      response.writeHead(405).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, 'http://localhost').pathname,
      );
      const filename = resolve(
        root,
        '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''),
      );
      if (!filename.startsWith(resolve(root) + sep)) {
        response.writeHead(403).end();
        return;
      }
      const body = await readFile(filename);
      const contentType =
        {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.mjs': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json',
        }[extname(filename)] || 'application/octet-stream';
      response.writeHead(200, { 'Content-Type': contentType }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
