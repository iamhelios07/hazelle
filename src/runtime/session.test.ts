import { describe, expect, it } from 'vitest';
import { resolveConnection } from '../connectors/registry';
import type { Connection } from '../connectors/types';
import { appendUserMessage, startChat } from './chat-log';
import { addPersona, setDefaultPersona } from './personas';
import { stubRelay, testServer, upstream } from './testing';

const server = testServer();

const copilot: Connection = { type: 'copilot', label: 'Copilot · jin', baseUrl: null, protocol: null, secret: 'gho_x', starred: [] };
const EXCHANGE = 'https://api.github.com/copilot_internal/v2/token';
const MODELS = 'https://api.githubcopilot.com/models';

describe('session', () => {
  it('drops its tokens and model lists on close, and keeps none from a trade answered after it', () =>
    server.withSession(async (session) => {
      const log = stubRelay(({ url }) => (url === EXCHANGE ? upstream(200, { token: 'tid', expires_at: Math.floor(Date.now() / 1000) + 1800 }) : upstream(200, { data: [] })));
      const resolved = resolveConnection(copilot)!;
      expect(await session.credentials.get(resolved, copilot.secret)).toEqual({ ok: true, credential: 'tid' });
      expect(await session.catalogs.load(copilot)).toEqual({ ok: true, models: [] });

      const trading = session.credentials.get(resolved, 'gho_other');
      session.close();
      const stopped = { ok: false, failure: { kind: 'stopped' } };
      expect(await trading).toEqual(stopped);
      expect(await session.credentials.get(resolved, copilot.secret)).toEqual(stopped);
      expect(await session.catalogs.load(copilot)).toEqual(stopped);
      expect(log.map((call) => call.sent.url)).toEqual([EXCHANGE, MODELS, EXCHANGE]);
    }));

  it('opens with the starter prompt as the default', () =>
    server.withSession(async (session) => {
      const { prompts, settings } = session.views();
      expect(prompts.map((prompt) => prompt.value.name)).toEqual(['🏓 핑퐁 간소화']);
      expect(settings.prompt).toBe(prompts[0]!.id);
    }));

  it('gives the same views until the store changes', () =>
    server.withSession(async (session) => {
      const first = session.views();
      expect(session.views()).toBe(first);
      const chat = await session.store.create('chat', { title: null, character: null, models: {} });
      const next = session.views();
      expect(next).not.toBe(first);
      expect(next.chats.map((item) => item.id)).toEqual([chat.ok && chat.data.id]);
      expect(session.views()).toBe(next);
    }));

  it("renders a chat's texts again when its messages change, and when what every chat reads changes", () =>
    server.withSession(async (session) => {
      const { store } = session;
      const chat = crypto.randomUUID();
      await startChat(store, chat, { title: null, character: null, models: {} }, null);
      await appendUserMessage(store, chat, { id: crypto.randomUUID(), text: '{{user}}, hello' });
      expect(session.views().chatById.get(chat)?.preview).toBe('jin, hello');
      const persona = await addPersona(store, { name: 'Mina', description: '', picture: null });
      await setDefaultPersona(store, persona.ok ? persona.data.id : '');
      expect(session.views().chatById.get(chat)?.preview).toBe('Mina, hello');
      await appendUserMessage(store, chat, { id: crypto.randomUUID(), text: 'bye, {{user}}' });
      expect(session.views().chatById.get(chat)?.preview).toBe('bye, Mina');
    }));
});
