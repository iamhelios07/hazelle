import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

// frame-src is also the tool pages' navigation boundary: adding any host there opens a way out for them.
export const CSP =
  "default-src 'self'; img-src 'self' data: blob:; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'";
export const SANDBOX_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'self' blob: 'unsafe-eval' 'wasm-unsafe-eval'; worker-src blob:; connect-src 'none'; img-src data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; media-src data: blob:; frame-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";
export const SANDBOX_HEADERS = { 'Content-Security-Policy': SANDBOX_CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache' };
const HEADERS = { 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
// Every file under /assets has a content hash in its name, so a changed file is a new URL.
const IMMUTABLE = 'public, max-age=31536000, immutable';

export function clientFiles(clientDir: string) {
  const client = new Hono();
  client.use(async (c, next) => {
    const started = performance.now();
    await next();
    c.res.headers.set('Server-Timing', `static;dur=${(performance.now() - started).toFixed(1)}`);
    if (c.res.ok && /^(?:text\/|application\/(?:javascript|json|wasm)|image\/svg\+xml)/.test(c.res.headers.get('Content-Type') ?? '')) c.res.headers.set('Vary', 'Accept-Encoding');
  });
  const sandbox = serveStatic({ root: clientDir, path: 'sandbox.html', precompressed: true });
  client.get('/sandbox.html', async (c) => {
    for (const [name, value] of Object.entries(SANDBOX_HEADERS)) c.header(name, value);
    return (await sandbox(c, async () => {})) || c.notFound();
  });
  const page = serveStatic({ root: clientDir, path: 'index.html', precompressed: true });
  client.use(async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(HEADERS)) c.res.headers.set(name, value);
    // ok, not 200: a Range answer (206) of an asset is as immutable as the whole.
    if (!c.res.ok) return;
    const asset = c.req.path.startsWith('/assets/');
    c.res.headers.set('Cache-Control', asset ? IMMUTABLE : 'no-cache');
    // A tool page's origin is opaque, so its stylesheet and fonts arrive as CORS fetches. Assets are public build files.
    if (asset) c.res.headers.set('Access-Control-Allow-Origin', '*');
  });
  client.get('*', serveStatic({ root: clientDir, precompressed: true }));
  // A path that is no file is a client route, whatever it looks like: model ids carry dots
  // (/models/<connection>/vendor/model-4.5). Only a page load gets the page; a missing asset is a real 404.
  client.get('*', async (c, next) => {
    const load = !c.req.path.startsWith('/assets/') && c.req.header('accept')?.includes('text/html');
    return (load && (await page(c, next))) || c.notFound();
  });
  return client;
}
