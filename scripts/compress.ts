import { readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import type { Plugin } from 'vite';

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

export async function compressClient(dir: string) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && /\.(?:html|css|js|json|svg|wasm)$/.test(entry.name)).values();
  await Promise.all(Array.from({ length: 2 }, async () => {
    for (const entry of files) {
      const path = join(entry.parentPath, entry.name);
      const body = await readFile(path);
      const [br, compressed] = await Promise.all([brotli(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }), gz(body, { level: 9 })]);
      await Promise.all(([['br', br], ['gz', compressed]] as const).map(async ([extension, bytes]) => {
        if (bytes.length < body.length) await writeFile(`${path}.${extension}`, bytes);
        else await rm(`${path}.${extension}`, { force: true });
      }));
    }
  }));
}

export function compressedAssets(): Plugin {
  return { name: 'hazelle-compressed-assets', apply: 'build', writeBundle: (options) => compressClient(options.dir!) };
}
