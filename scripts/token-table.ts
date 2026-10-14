import { pathToFileURL } from 'node:url';
import type { Plugin } from 'vite';

const TABLE = '/node_modules/gpt-tokenizer/esm/bpeRanks/o200k_base.js';

// gpt-tokenizer ships the o200k table as two array literals of ~100k strings, and the minifier writes each string as a
// template literal. Safari's engine gives every non-constant element of an array literal its own register, so on iOS
// the evaluation worker's stack overflows evaluating the chunk (RangeError: Maximum call stack size exceeded). One
// string handed to JSON.parse has no elements to spill, whatever quotes the minifier picks.
export function tokenTable(): Plugin {
  return {
    name: 'hazelle-token-table',
    async load(id) {
      if (!id.endsWith(TABLE)) return null;
      const { default: ranks } = (await import(pathToFileURL(id).href)) as { default: (string | number[])[] };
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(ranks))});`;
    },
  };
}
