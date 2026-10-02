import { describe, expect, it } from 'vitest';
import { fold, shown } from '../model/chat';
import { startChat } from './chat-log';
import type { Session } from './session';
import { answerable, saying, stubRelay, testCard, testServer } from './testing';
import { displayChat, takeTurn } from './turn';

const server = testServer();

// A chat with a character whose one Lua trigger is code, opened on its greeting.
async function chatWith(session: Session, code: string) {
  await answerable(session);
  const card = { ...testCard('루나'), greetings: ['어서 와.'], description: 'turn {{getvar::turn}}', triggers: [{ kind: 'lua' as const, name: 'main', code }] };
  const character = await session.store.create('character', { card, folder: null, loreFolders: [] });
  if (!character.ok) throw new Error(character.error);
  const chat = crypto.randomUUID();
  await server.hold(session.store, chat);
  const greeting = crypto.randomUUID();
  await startChat(session.store, chat, { title: null, character: character.data.id, models: {} }, { ids: [greeting], texts: card.greetings, selected: 0, translations: new Map() });
  const messages = () => fold(session.store.children('entry', chat));
  const shownTexts = () => displayChat(session, chat, session.store.get('chat', chat)!.value, messages()).texts;
  return { chat, messages, shownTexts };
}

describe("a turn with the bot's Lua", () => {
  it('runs input, start, the edit hooks and output in order, saving what each wrote where the story replays it', () =>
    server.withSession(async (session) => {
      const { chat, messages, shownTexts } = await chatWith(
        session,
        `function onInput(id) setChatVar(id, 'order', 'input') end
        listenEdit('editInput', function(id, value) return value .. ' [' .. getChatVar(id, 'order') .. ']' end)
        function onStart(id)
          setChatVar(id, 'turn', getChatLength(id) .. ':' .. getChat(id, -1).data)
          addChat(id, 'char', 'narration')
        end
        listenEdit('editOutput', function(id, value) return value .. ' (' .. getChatVar(id, 'turn') .. ')' end)
        function onOutput(id)
          setState(id, 'seen', getChat(id, -1).data)
          setChat(id, -1, getChat(id, -1).data .. '!')
        end`,
      );
      const log = stubRelay(() => saying('왔구나 {{getvar::turn}}'));
      expect(await takeTurn(session, chat, { kind: 'send', text: '안녕' })).toBeNull();
      await expect.poll(() => messages().length).toBe(4);

      const [, said, narration, reply] = messages();
      expect(shown(said!)).toMatchObject({ text: '안녕 [input]', before: [['order', 'input']] });
      expect(shown(narration!)).toMatchObject({ text: 'narration', staged: true });
      await expect.poll(() => shown(messages()[3]!).edited).toBe(true);
      expect(shown(messages()[3]!)).toMatchObject({ text: '왔구나 1:안녕 [input] (1:안녕 [input])!', staged: true, before: [['turn', '1:안녕 [input]']], after: [['__seen', '"왔구나 1:안녕 [input] (1:안녕 [input])"']] });
      expect(reply!.versions).toHaveLength(1);
      expect(shownTexts().at(-1)).toBe('왔구나 1:안녕 [input] (1:안녕 [input])!');
      expect(JSON.stringify(log[0]!.sent.body)).toContain('turn 1:안녕 [input]');
      expect(JSON.stringify(log[0]!.sent.body)).toContain('narration');
    }));

  it('ends the turn before any request on stopChat, keeping the message and what was written', () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `function onStart(id) setChatVar(id, 'handled', getChat(id, -1).data) stopChat(id) end`);
      const log = stubRelay(() => saying('never'));
      expect(await takeTurn(session, chat, { kind: 'send', text: '/roll' })).toBeNull();
      expect(log).toHaveLength(0);
      expect(shown(messages()[1]!)).toMatchObject({ text: '/roll', after: [['handled', '/roll']] });
    }));

  it("answers a button with the script's function and keeps its writes after the last message", () =>
    server.withSession(async (session) => {
      const { chat, messages } = await chatWith(session, `function open(id) setChatVar(id, 'door', 'open') alertNormal(id, 'opened') end`);
      expect(await session.scripts.press(chat, { trigger: 'open' })).toBe(true);
      expect(await session.scripts.press(chat, { trigger: 'missing' })).toBe(false);
      expect(shown(messages()[0]!).after).toEqual([['door', 'open']]);
      expect(session.scripts.snapshot().notes).toMatchObject([{ chat, kind: 'said', tone: 'normal', text: 'opened' }]);
    }));
});
