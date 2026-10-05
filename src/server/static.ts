import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

// The page and its files, the built client under clientDir. node.ts mounts this after every /api route.
export const CSP =
  "default-src 'self'; img-src 'self' data: blob:; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'";
const HEADERS = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
// Every file under /assets has a content hash in its name, so a changed file is a new URL.
const IMMUTABLE = 'public, max-age=31536000, immutable';

export function clientFiles(clientDir: string) {
  const client = new Hono();
  const page = serveStatic({ root: clientDir, path: 'index.html' });
  client.use(async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(HEADERS)) c.res.headers.set(name, value);
    if (c.res.status === 200) c.res.headers.set('Cache-Control', c.req.path.startsWith('/assets/') ? IMMUTABLE : 'no-cache');
  });
  client.get('*', serveStatic({ root: clientDir }));
  // A path that is no file is a client route, whatever it looks like: model ids carry dots
  // (/models/<connection>/vendor/model-4.5). Only a page load gets the page; a missing asset is a real 404.
  client.get('*', async (c, next) => {
    const load = !c.req.path.startsWith('/assets/') && c.req.header('accept')?.includes('text/html');
    return (load && (await page(c, next))) || c.notFound();
  });
  return client;
}
