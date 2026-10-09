import { build } from 'esbuild';
import type { Plugin } from 'vite';
import { SANDBOX_HEADERS } from '../src/server/static';

export async function sandboxSource(): Promise<string> {
  const options = { bundle: true, write: false, format: 'iife' as const, platform: 'browser' as const, target: 'es2023', logLevel: 'silent' as const };
  const background = await build({ ...options, entryPoints: ['src/sandbox/background.ts'] });
  const page = await build({ ...options, entryPoints: ['src/sandbox/page.ts'], define: { BACKGROUND_SOURCE: JSON.stringify(background.outputFiles![0]!.text) } });
  return page.outputFiles![0]!.text;
}

export function sandbox(): Plugin {
  return {
    name: 'hazelle-sandbox',
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'sandbox/host.js', source: await sandboxSource() });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0];
        if (path === '/sandbox.html') {
          for (const [name, value] of Object.entries(SANDBOX_HEADERS)) response.setHeader(name, value);
        } else {
          // HMR needs its own script policy; tool pages still cannot navigate off-origin in development.
          response.setHeader('Content-Security-Policy', "frame-src 'self'");
        }
        if (path !== '/sandbox/host.js') return next();
        response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
        response.setHeader('Cache-Control', 'no-cache');
        void sandboxSource().then((source) => response.end(source), (error: unknown) => next(error));
      });
    },
  };
}
