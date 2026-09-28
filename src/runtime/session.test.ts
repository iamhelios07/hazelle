import { describe, expect, it } from 'vitest';
import { resolveConnection } from '../connectors/registry';
import type { Connection } from '../connectors/types';
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
});
