import { describe, expect, it } from 'vitest';
import type { RegexScript } from '../engine/import/types';
import { addLua, editRegex, moveScript, removeScript, restoreScript, setScriptOff, type PackOwner } from './pack';
import type { ObjectStore } from './store';
import { testCard, testServer } from './testing';

const server = testServer();

const script = (id: string, stage: RegexScript['stage']): RegexScript => ({ id, name: id, find: id, replace: '', stage, flags: null });
const REGEX = [script('a', 'display'), script('b', 'output'), script('c', 'display')];

async function character(store: ObjectStore): Promise<PackOwner> {
  const created = await store.create('character', { card: { ...testCard('루나'), regex: REGEX }, folder: null, loreFolders: [] });
  if (!created.ok) throw new Error(created.error);
  return { kind: 'character', id: created.data.id };
}

const regexOf = (store: ObjectStore, { id }: PackOwner) => store.get('character', id)!.value.card.regex;

describe('pack scripts', () => {
  it('moves a regex script past the nearest one of its stage, and an edit made meanwhile on another device lands on the script it named', async () => {
    const { store, open } = await server.account();
    const owner = await character(store);
    const other = await open();
    await other.pull();
    expect((await moveScript(store, owner, 'regex', 'c', -1)).ok).toBe(true);
    expect((await editRegex(other, owner, 'a', { find: 'edited' })).ok).toBe(true);
    await store.pull();
    expect(regexOf(store, owner).map(({ id, find }) => `${id}:${find}`)).toEqual(['c:c', 'b:b', 'a:edited']);
    expect(await moveScript(store, owner, 'regex', 'c', -1)).toMatchObject({ ok: false, error: 'gone' });
  });

  it('puts a removed script back where it stood, turned off as it was', async () => {
    const { store } = await server.account();
    const owner = await character(store);
    await setScriptOff(store, owner, 'regex', 'b', true);
    const removed = await removeScript(store, owner, 'regex', 'b');
    if (!removed.ok) throw new Error(removed.error);
    expect(regexOf(store, owner).map(({ id }) => id)).toEqual(['a', 'c']);
    await restoreScript(store, owner, removed.data);
    expect(regexOf(store, owner)).toEqual([REGEX[0], { ...REGEX[1], off: true }, REGEX[2]]);
  });

  it("writes a module's scripts at its top level, as a character's in its card", async () => {
    const { store } = await server.account();
    const created = await store.create('module', { name: 'Bell', description: '', namespace: null, regex: [], triggers: [], toggles: '', loreFolders: [] });
    if (!created.ok) throw new Error(created.error);
    await addLua(store, { kind: 'module', id: created.data.id }, 'lua');
    expect(store.get('module', created.data.id)!.value).toMatchObject({ triggers: [{ kind: 'lua', id: 'lua', name: '', code: '' }] });
  });
});
