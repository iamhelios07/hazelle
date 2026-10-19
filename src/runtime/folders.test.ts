import { describe, expect, it } from 'vitest';
import { addPersona, removePersona } from './personas';
import { createCharacter, seedOrder } from './characters';
import { ORDER_ID } from '../model/order';
import { createFolder, folderRemoval, moveInto, removeFolder, restoreFolder } from './folders';
import { testServer } from './testing';

const server = testServer();

describe('folders', () => {
  it('keeps the first order written and files a character first in 직접 순서', async () => {
    const { store } = await server.account();
    const order = () => store.get('order', ORDER_ID)?.value.ids;
    const [a, b, c] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    for (const id of [a, b, c]) await createCharacter(store, id, id);
    await seedOrder(store, [a, b, c]);
    await seedOrder(store, [c, b, a]);
    expect(order()).toEqual([a, b, c]);
    const folder = await createFolder(store, 'character', '즐겨찾기', null);
    await moveInto(store, 'character', [c], folder.ok ? folder.data.id : null);
    expect(order()).toEqual([c, a, b]);
  });


  it("takes a middle folder with the folders inside it and moves its kind's things, 휴지통's too, to the folder it sat in, and brings all back", async () => {
    const { store } = await server.account();
    const made = async (name: string, parent: string | null, kind: 'persona' | 'character' = 'persona') => {
      const saved = await createFolder(store, kind, name, parent);
      return saved.ok ? saved.data.id : '';
    };
    const top = await made('판타지', null);
    const middle = await made('기사단', top);
    const inner = await made('학원물', middle);
    const theirs = await made('기사단', null, 'character');
    const people = await Promise.all(['진', '린', '현'].map((name) => addPersona(store, { name, description: '', picture: null })));
    const [jin, rin, hyun] = people.map((added) => (added.ok ? added.data.id : ''));
    await moveInto(store, 'persona', [jin!], inner);
    await moveInto(store, 'persona', [rin!], middle);
    await moveInto(store, 'persona', [hyun!], top);
    await removePersona(store, rin!);
    const folderOf = (id: string) => store.get('persona', id)!.value.folder;

    expect(folderRemoval(store, theirs)?.kind).toBe('character');
    const removal = folderRemoval(store, middle)!;
    expect([removal.kind, removal.up?.id, removal.folders.map(({ id }) => id)]).toEqual(['persona', top, [middle, inner]]);
    await removeFolder(store, removal);
    expect([folderOf(jin!), folderOf(rin!), folderOf(hyun!)]).toEqual([top, top, top]);
    expect([store.get('folder', middle), store.get('folder', inner), store.get('folder', theirs)?.value.of]).toEqual([null, null, undefined]);

    await restoreFolder(store, removal);
    expect([folderOf(jin!), folderOf(rin!), store.get('folder', inner)?.value]).toEqual([inner, middle, { name: '학원물', parent: middle, of: 'persona' }]);

    const outermost = folderRemoval(store, top)!;
    await removeFolder(store, outermost);
    expect('folder' in store.get('persona', hyun!)!.value).toBe(false);
  });

  it('leaves a thing moved elsewhere after the removal was decided where it went, on removal and on undo', async () => {
    const { store } = await server.account();
    const made = async (name: string, parent: string | null) => {
      const saved = await createFolder(store, 'persona', name, parent);
      return saved.ok ? saved.data.id : '';
    };
    const top = await made('판타지', null);
    const inner = await made('기사단', top);
    const away = await made('현대', null);
    const added = await addPersona(store, { name: '진', description: '', picture: null });
    const jin = added.ok ? added.data.id : '';
    await moveInto(store, 'persona', [jin], inner);

    const removal = folderRemoval(store, inner)!;
    await moveInto(store, 'persona', [jin], away);
    await removeFolder(store, removal);
    expect(store.get('persona', jin)!.value.folder).toBe(away);
    await restoreFolder(store, removal);
    expect(store.get('persona', jin)!.value.folder).toBe(away);
  });
});
