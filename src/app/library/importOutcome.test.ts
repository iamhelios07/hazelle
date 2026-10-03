import { expect, it } from 'vitest';
import { importCard } from '../../engine/import/card';
import type { ImportedModule } from '../../engine/import/types';
import { characterOutcome, moduleOutcome } from './importOutcome';

it('keeps completed card and module reports as detached text without asset readers or source bytes', () => {
  const parsed = importCard('card.json', new TextEncoder().encode(JSON.stringify({ spec: 'chara_card_v3', data: { name: 'Mira', first_mes: 'Hi' } })));
  if (!parsed.ok || !('card' in parsed)) throw new Error('fixture');
  const bytes = new Uint8Array([1, 2, 3]);
  const imported = { ...parsed.card, assets: [{ name: 'picture', read: async () => bytes }] };
  const card = characterOutcome('card.charx', imported, { id: 'character', skipped: 1, faceless: true });
  const module: ImportedModule = { name: 'Bell', description: '', namespace: null, risu: null, pack: imported.card, lore: [], loreFolders: [], assets: imported.assets, unsupported: [] };
  const report = moduleOutcome('bell.risum', module, 'module', 0);
  expect(card).toEqual({ kind: 'character', file: 'card.charx', id: 'character', title: 'Mira', holds: '첫인사 1개', missed: ['그림: 읽지 못함', '에셋 1개'], unused: null });
  expect(report).toEqual({ kind: 'module', file: 'bell.risum', id: 'module', title: '모듈 · Bell', holds: '에셋 1개', missed: [], unused: null });
  expect(structuredClone([card, report])).toEqual([card, report]);
  imported.card.name = 'Changed';
  imported.assets.length = 0;
  expect(card.title).toBe('Mira');
  expect(report.holds).toBe('에셋 1개');
});
