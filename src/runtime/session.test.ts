import { describe, expect, it } from 'vitest';
import { resolveConnection } from '../connectors/registry';
import type { Connection } from '../connectors/types';
import { firstTurns } from '../model/turns';
import { appendUserMessage, startChat } from './chat-log';
import { editPersona } from './personas';
import { stubRelay, testServer, upstream } from './testing';

const server = testServer();

const copilot: Connection = { type: 'copilot', label: 'Copilot', baseUrl: null, protocol: null, accounts: [{ id: 'key', secret: 'gho_x', name: 'jin' }], turns: firstTurns('group', 'key'), starred: [] };
const USER = 'https://api.github.com/copilot_internal/user';
const EXCHANGE = 'https://api.github.com/copilot_internal/v2/token';
const MODELS = 'https://api.githubcopilot.com/models';
const unlimited = { quota_snapshots: { premium_interactions: { unlimited: true } } };

describe('session', () => {
  it('drops its tokens and model lists on close, and keeps none from a trade answered after it', () =>
    server.withSession(async (session) => {
      // The session closes while the second trade is on its way, so its answer arrives after close.
      const log = stubRelay(({ url, headers }) => {
        if (headers.authorization === 'Bearer gho_other') session.close();
        return url === EXCHANGE ? upstream(200, { token: 'tid', expires_at: Math.floor(Date.now() / 1000) + 1800 }) : upstream(200, url === USER ? unlimited : { data: [] });
      });
      const resolved = resolveConnection(copilot)!;
      expect(await session.credentials.get(resolved, copilot.accounts[0]!.secret)).toEqual({ ok: true, credential: 'tid' });
      expect(await session.catalogs.load(copilot)).toEqual({ ok: true, models: [] });

      const trading = session.credentials.get(resolved, 'gho_other');
      const stopped = { ok: false, failure: { kind: 'stopped' } };
      expect(await trading).toEqual(stopped);
      expect(await session.credentials.get(resolved, copilot.accounts[0]!.secret)).toEqual(stopped);
      expect(await session.catalogs.load(copilot)).toEqual(stopped);
      expect(log.map((call) => call.sent.url)).toEqual([EXCHANGE, USER, MODELS, EXCHANGE]);
    }));

  it('opens with each sort’s default prompt', () =>
    server.withSession(async (session) => {
      const prompts = session.read.kind('prompt').snapshot();
      const settings = session.read.settings.snapshot();
      const named = (id: string | undefined) => prompts.find((prompt) => prompt.id === id)?.value.name;
      expect([prompts.length, named(settings.prompt), named(settings.translatePrompt), named(settings.memoryPrompt), named(settings.illustratePrompt)]).toEqual([4, '🏓 핑퐁 간소화', '기본 번역', '기본 기억', '기본 삽화']);
    }));

  it('gives the same summaries until the store changes', () =>
    server.withSession(async (session) => {
      const first = session.read.chats.snapshot();
      expect(session.read.chats.snapshot()).toBe(first);
      const chat = await session.store.create('chat', { title: null, character: null, models: {} });
      const next = session.read.chats.snapshot();
      expect(next).not.toBe(first);
      expect(next.map((item) => item.id)).toEqual([chat.ok && chat.data.id]);
      expect(session.read.chats.snapshot()).toBe(next);
    }));

  it("updates a chat's preview when its messages or its persona dependency change", () =>
    server.withSession(async (session) => {
      const { store } = session;
      const chat = crypto.randomUUID();
      await server.hold(session.store, chat);
      await startChat(store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(store, chat, { id: crypto.randomUUID(), text: '{{user}}, hello' });
      expect(session.read.chat(chat).snapshot()?.preview).toBe('jin, hello');
      await editPersona(store, store.get('chat', chat)!.value.persona!, { name: 'Mina' });
      expect(session.read.chat(chat).snapshot()?.preview).toBe('Mina, hello');
      await appendUserMessage(store, chat, { id: crypto.randomUUID(), text: 'bye, {{user}}' });
      expect(session.read.chat(chat).snapshot()?.preview).toBe('bye, Mina');
    }));
});
