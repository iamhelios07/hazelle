import { pathToFileURL } from 'node:url';
import type { Plugin } from 'vite';

const TABLE = '/node_modules/gpt-tokenizer/esm/bpeRanks/o200k_base.js';

// gpt-tokenizer ships the o200k table as two array literals of ~100k strings, and the minifier writes each string as a
// template literal. Evaluating that chunk overflows the stack in iOS Safari's workers (RangeError: Maximum call stack
// size exceeded); plain string elements do not. Desktop WebKit passes either way: a repro needs Playwright's WebKit
// launched with JSC_maxPerThreadStackUsage=512000. One string handed to JSON.parse has no elements, whatever quotes the
// minifier picks.
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
