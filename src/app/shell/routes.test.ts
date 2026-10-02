import { describe, expect, it } from 'vitest';
import { CONNECTION_TYPES } from '../../connectors/registry';
import { backTo, HOME, href, parseRoute, up, type Route } from './routes';

const CHARACTER = '6f1c2a8e-3b4d-4e5f-8a9b-0c1d2e3f4a5b';
const CHAT = 'a0b1c2d3-e4f5-4a6b-8c7d-9e0f1a2b3c4d';

// Keyed by kind, so a new kind of route does not compile until it has an example here.
const EXAMPLES = {
  home: [{ kind: 'home' }],
  gallery: [{ kind: 'gallery' }],
  shelf: [
    { kind: 'shelf', character: CHARACTER },
    { kind: 'shelf', character: null },
  ],
  about: [{ kind: 'about', character: CHARACTER }],
  edit: [{ kind: 'edit', character: CHARACTER }],
  'new-chat': [
    { kind: 'new-chat', character: CHARACTER },
    { kind: 'new-chat', character: null },
  ],
  chat: [{ kind: 'chat', id: CHAT }],
  connections: [{ kind: 'connections' }],
  'add-connection': [{ kind: 'add-connection' }],
  connect: CONNECTION_TYPES.map((type) => ({ kind: 'connect', type })),
  'connect-direct': [
    { kind: 'connect-direct', address: '' },
    { kind: 'connect-direct', address: 'https://llm.example.com/v1?key=a b&x=1+2#top' },
  ],
  connection: [{ kind: 'connection', id: CHAT }],
  prompts: [{ kind: 'prompts' }],
  prompt: [
    { kind: 'prompt', id: CHAT, pane: null },
    { kind: 'prompt', id: CHAT, pane: 'toggles' },
  ],
  personas: [{ kind: 'personas' }],
  persona: [{ kind: 'persona', id: CHAT }],
  modules: [{ kind: 'modules' }],
  module: [{ kind: 'module', id: CHAT }],
  models: [{ kind: 'models' }],
  profile: [{ kind: 'profile', id: CHAT }],
  model: [
    { kind: 'model', connection: CHAT, model: 'claude-opus-5.5' },
    { kind: 'model', connection: CHAT, model: 'anthropic/claude-opus-5.5' },
    { kind: 'model', connection: CHAT, model: 'a b%c@d?e#f' },
    { kind: 'model', connection: CHAT, model: 'a//b/' },
  ],
  account: [{ kind: 'account' }],
  settings: [{ kind: 'settings' }],
} satisfies { [K in Route['kind']]: Extract<Route, { kind: K }>[] };

describe('routes', () => {
  it.each(Object.values(EXAMPLES).flat().map((route) => [href(route), route] as const))('%s reads back as the route it came from', (at, route) => {
    expect(parseRoute(at)).toEqual(route);
  });

  it('keeps every address the app has had', () => {
    expect(href({ kind: 'shelf', character: null })).toBe('/characters/none');
    expect(href({ kind: 'new-chat', character: null })).toBe('/chats/new');
    expect(href({ kind: 'new-chat', character: CHARACTER })).toBe(`/characters/${CHARACTER}/new`);
    expect(href({ kind: 'connect-direct', address: 'https://a.example/v1' })).toBe('/connections/new/direct?address=https%3A%2F%2Fa.example%2Fv1');
    const model = { kind: 'model', connection: CHAT, model: 'anthropic/claude-opus-5.5' } as const;
    expect(parseRoute(`/models/${CHAT}/anthropic%2Fclaude-opus-5.5`)).toEqual(model);
    expect(href(model)).toBe(`/models/${CHAT}/anthropic/claude-opus-5.5`);
  });

  it.each(['/nope', '/characters/', '/characters/abc', '/characters/none/about', `/characters/${CHARACTER}/other`, '/chats', `/chats/${CHAT}/x`, '/connections/', '/connections/new/nope', '/prompts/abc', `/prompts/${CHAT}/x`, `/connections/abc/model`, `/connections/${CHAT}/model`, '/personas/abc', `/personas/${CHAT}/x`, '/modules/abc', `/modules/${CHAT}/x`, '/models/abc', `/models/abc/x`, `/models/${CHAT}/%E0%A4%A`, '/settings/x'])(
    '%s is home',
    (at) => {
      expect(parseRoute(at)).toEqual(HOME);
    },
  );

  it('sends 뒤로 from a chat to its character’s chats, or home when the chat is not there', () => {
    const chats = new Map([[CHAT, { chat: { character: CHARACTER } }]]);
    expect(backTo(up({ kind: 'chat', id: CHAT }, false, chats), false)).toEqual({ to: { kind: 'shelf', character: CHARACTER }, label: '채팅 목록' });
    expect(up({ kind: 'chat', id: CHARACTER }, false, chats)).toEqual(HOME);
  });

  it('sends 뒤로 from the editor to the character’s page for the layout', () => {
    const edit = { kind: 'edit', character: CHARACTER } as const;
    expect(backTo(up(edit, true, new Map()), true)).toEqual({ to: { kind: 'shelf', character: CHARACTER }, label: '캐릭터' });
    expect(backTo(up(edit, false, new Map()), false)).toEqual({ to: { kind: 'about', character: CHARACTER }, label: '캐릭터' });
  });
});
