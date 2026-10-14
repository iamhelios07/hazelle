import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { tokenTable } from './token-table';

it('ships the o200k table as one JSON string that parses back to the same ranks', async () => {
  const id = resolve('node_modules/gpt-tokenizer/esm/bpeRanks/o200k_base.js');
  const code = (await (tokenTable().load as (id: string) => Promise<string>)(id));
  expect(code).toMatch(/^export default JSON\.parse\("/);
  const shipped = (await import(`data:text/javascript,${encodeURIComponent(code)}`)) as { default: unknown };
  const original = (await import(pathToFileURL(id).href)) as { default: unknown };
  expect(shipped.default).toEqual(original.default);
});
