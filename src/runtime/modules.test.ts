import { describe, expect, it } from 'vitest';
import { fold } from '../model/chat';
import { startChat } from './chat-log';
import { projectGreetings } from './greetings';
import { importModule, modulesOf, setCharacterModule, setModuleAlways, setModuleDeleted } from './modules';
import { chatPrompt } from './prompts';
import { answerable, saying, stubRelay, testCard, testServer } from './testing';
import { evaluateChat, takeTurn, togglesOf } from './turn';

const server = testServer();

const lore = { name: 'Bell', keys: [], secondaryKeys: [], content: 'A bell rings at noon.', enabled: true, constant: true, selective: false, useRegex: false, caseSensitive: false, insertionOrder: 10, priority: null, position: null, folder: null };

describe('modules', () => {
  it("works on a chat after the character's own pack while on for the character or always, and not once deleted", () =>
    server.withSession(async (session) => {
      const { store, files } = session;
      await answerable(session);
      const card = { ...testCard('루나'), greetings: ['the lamp'], regex: [{ name: 'own', find: 'lamp', replace: 'LAMP', stage: 'display' as const, flags: null }] };
      const character = await store.create('character', { card, folder: null, loreFolders: [] });
      if (!character.ok) throw new Error(character.error);
      const pack = {
        regex: [{ name: 'after', find: 'LAMP', replace: 'STAR', stage: 'display' as const, flags: null }],
        triggers: [{ kind: 'lua' as const, name: 'main', code: `listenEdit('editOutput', function(id, value) return value .. ' (module)' end)` }],
        background: '<style>.bell { color: red }</style>',
        toggles: 'ring=Ring',
      };
      const added = await importModule(store, files, { name: 'Bell', description: '', namespace: 'bell', risu: null, pack, lore: [lore], loreFolders: [], assets: [], unsupported: [] }, () => {});
      if (!added.ok) throw new Error(added.error);
      const module = added.data.id;

      const chat = crypto.randomUUID();
      await server.hold(store, chat);
      await startChat(store, chat, { title: null, character: character.data.id, models: {} }, projectGreetings(card.greetings, [crypto.randomUUID()], 0));
      const value = () => store.get('chat', chat)!.value;
      const shown = () => evaluateChat(session, chat, value(), fold(store.children('entry', chat)));
      const toggles = () => togglesOf(store, value(), chatPrompt(store, value())).declared.map(({ key }) => key);
      expect((await shown()).texts).toEqual(['the LAMP']);

      await setCharacterModule(store, character.data.id, module, true);
      expect(await shown()).toMatchObject({ texts: ['the STAR'], css: '.bell { color: red }' });
      expect(toggles()).toContain('ring');
      const log = stubRelay(() => saying('noon'));
      expect(await takeTurn(session, chat, { kind: 'send', text: 'hi' })).toBeNull();
      await expect.poll(async () => (await shown()).texts.at(-1)).toBe('noon (module)');
      expect(log[0]!.sent.body).toContain('A bell rings at noon.');

      await setCharacterModule(store, character.data.id, module, false);
      expect((await shown()).texts[0]).toBe('the LAMP');
      await setModuleAlways(store, module, true);
      expect((await shown()).texts[0]).toBe('the STAR');

      await setModuleDeleted(store, module, Date.now());
      expect((await shown()).texts[0]).toBe('the LAMP');
      expect(modulesOf(store)).toEqual([]);
      await setModuleDeleted(store, module, null);
      expect((await shown()).texts[0]).toBe('the STAR');
    }));
});
