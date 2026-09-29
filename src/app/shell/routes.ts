import { CONNECTION_TYPES } from '../../connectors/registry';
import type { ConnectionType } from '../../connectors/types';
import type { Shelf } from '../../model/library';

// Every place in the app, as the address bar names it. These paths are what a reload, a bookmark and
// the browser's back button land on, so an existing one never changes.
export type Route =
  | { kind: 'home' }
  // 캐릭터 둘러보기 on its own path, which phones open from the character list.
  | { kind: 'gallery' }
  // A character's chats, and on wide screens its own page beside them. character null is 캐릭터 없이.
  | { kind: 'shelf'; character: string | null }
  // A character's own page on phones, where its shelf is the list of its chats.
  | { kind: 'about'; character: string }
  | { kind: 'edit'; character: string }
  // A chat not saved yet, which is saved with its first message.
  | { kind: 'new-chat'; character: string | null }
  | { kind: 'chat'; id: string }
  | { kind: 'connections' }
  | { kind: 'add-connection' }
  | { kind: 'connect'; type: ConnectionType }
  // 직접 연결, with the address pasted into 연결 추가's search; '' when there was none.
  | { kind: 'connect-direct'; address: string }
  | { kind: 'connection'; id: string }
  // 설정's 프롬프트: the list, and one prompt's editor. pane opens the editor on its 토글 pane, which the
  // chat's toggle panel links to.
  | { kind: 'prompts' }
  | { kind: 'prompt'; id: string; pane: 'toggles' | null }
  | { kind: 'personas' }
  | { kind: 'persona'; id: string }
  // 설정's 모델 설정: the 설정 묶음 list, and one 묶음's editor.
  | { kind: 'profiles' }
  | { kind: 'profile'; id: string }
  // model: a starred model's id, which may hold any character; the path carries it escaped.
  | { kind: 'model'; connection: string; model: string }
  | { kind: 'defaults' }
  | { kind: 'account' }
  // 설정's own list of its pages, which phones open from the library.
  | { kind: 'settings' };

export const HOME: Route = { kind: 'home' };

type Kind<K extends Route['kind']> = Extract<Route, { kind: K }>;
// Every route but home has somewhere to go back up to.
export type Below = Exclude<Route, Kind<'home'>>;
// The chats by id, for the routes that sit inside a chat's character (shelfOf, up).
export type ChatShelves = ReadonlyMap<string, { chat: { character: string | null } }>;

const ID = /^[0-9a-f-]{36}$/;
const NONE = 'none';
// Before the connection type ids, so a type can never take over 직접 연결's path.
const DIRECT = 'direct';

// at is a path with its query, as href writes it. Any other path is home, since the app has no page for it.
export function parseRoute(at: string): Route {
  const query = at.indexOf('?');
  const path = query < 0 ? at : at.slice(0, query);
  const [top, id, sub, ...rest] = path.slice(1).split('/');
  // A model id's own slashes stay path separators: Cloudflare's asset handler redirects an escaped one (%2F) to a bare one.
  if (top === 'models' && id !== undefined && sub !== undefined) {
    const model = decoded([sub, ...rest]);
    return ID.test(id) && model ? { kind: 'model', connection: id, model } : HOME;
  }
  if (rest.length > 0) return HOME;
  if (top === 'characters') {
    if (id === undefined) return { kind: 'gallery' };
    if (id === NONE) return sub === undefined ? { kind: 'shelf', character: null } : HOME;
    if (!ID.test(id)) return HOME;
    if (sub === undefined) return { kind: 'shelf', character: id };
    if (sub === 'about') return { kind: 'about', character: id };
    if (sub === 'edit') return { kind: 'edit', character: id };
    if (sub === 'new') return { kind: 'new-chat', character: id };
    return HOME;
  }
  if (top === 'chats' && id !== undefined && sub === undefined) {
    if (id === 'new') return { kind: 'new-chat', character: null };
    if (ID.test(id)) return { kind: 'chat', id };
    return HOME;
  }
  if (top === 'connections') {
    if (id === undefined) return { kind: 'connections' };
    if (id !== 'new') {
      return ID.test(id) && sub === undefined ? { kind: 'connection', id } : HOME;
    }
    if (sub === undefined) return { kind: 'add-connection' };
    if (sub === DIRECT) return { kind: 'connect-direct', address: new URLSearchParams(query < 0 ? '' : at.slice(query)).get('address') ?? '' };
    const type = CONNECTION_TYPES.find((candidate) => candidate.id === sub);
    return type ? { kind: 'connect', type } : HOME;
  }
  if (top === 'prompts') {
    if (id === undefined) return { kind: 'prompts' };
    if (!ID.test(id) || sub !== undefined) return HOME;
    return { kind: 'prompt', id, pane: new URLSearchParams(query < 0 ? '' : at.slice(query)).get('pane') === 'toggles' ? 'toggles' : null };
  }
  if (top === 'personas' && sub === undefined) {
    if (id === undefined) return { kind: 'personas' };
    return ID.test(id) ? { kind: 'persona', id } : HOME;
  }
  if (top === 'models') {
    if (id === undefined) return { kind: 'profiles' };
    return ID.test(id) ? { kind: 'profile', id } : HOME;
  }
  if (id === undefined) {
    if (top === 'settings') return { kind: 'settings' };
    if (top === 'defaults') return { kind: 'defaults' };
    if (top === 'account') return { kind: 'account' };
  }
  return HOME;
}

// A malformed escape (a stray %) names no model.
function decoded(segments: string[]): string | null {
  try {
    return segments.map(decodeURIComponent).join('/') || null;
  } catch {
    return null;
  }
}

export function href(route: Route): string {
  switch (route.kind) {
    case 'home':
      return '/';
    case 'gallery':
      return '/characters';
    case 'shelf':
      return `/characters/${route.character ?? NONE}`;
    case 'about':
      return `/characters/${route.character}/about`;
    case 'edit':
      return `/characters/${route.character}/edit`;
    case 'new-chat':
      return route.character === null ? '/chats/new' : `/characters/${route.character}/new`;
    case 'chat':
      return `/chats/${route.id}`;
    case 'connections':
      return '/connections';
    case 'add-connection':
      return '/connections/new';
    case 'connect':
      return `/connections/new/${route.type.id}`;
    case 'connect-direct':
      return `/connections/new/${DIRECT}${route.address ? `?address=${encodeURIComponent(route.address)}` : ''}`;
    case 'connection':
      return `/connections/${route.id}`;
    case 'prompts':
      return '/prompts';
    case 'prompt':
      return `/prompts/${route.id}${route.pane ? `?pane=${route.pane}` : ''}`;
    case 'personas':
      return '/personas';
    case 'persona':
      return `/personas/${route.id}`;
    case 'profiles':
      return '/models';
    case 'profile':
      return `/models/${route.id}`;
    case 'model':
      return `/models/${route.connection}/${route.model.split('/').map(encodeURIComponent).join('/')}`;
    case 'defaults':
      return '/defaults';
    case 'account':
      return '/account';
    case 'settings':
      return '/settings';
  }
}

export const sidebarPage = (route: Route) => route.kind === 'home' || route.kind === 'shelf';

// The list a route sits in: its screen is the list itself, or the item beside it where there is room. null outside
// the connection, persona and 모델 설정 screens.
export function listOf(route: Route): Kind<'connections' | 'add-connection' | 'personas' | 'profiles'> | null {
  switch (route.kind) {
    case 'connections':
    case 'connection':
      return { kind: 'connections' };
    case 'personas':
    case 'persona':
      return { kind: 'personas' };
    case 'profiles':
    case 'profile':
    case 'model':
      return { kind: 'profiles' };
    case 'add-connection':
    case 'connect':
    case 'connect-direct':
      return { kind: 'add-connection' };
    default:
      return null;
  }
}

export type SettingsPage = 'prompts' | 'personas' | 'connections' | 'profiles' | 'defaults' | 'account';

// Which page of 설정 a route is on, 'list' for 설정's own list, or null outside 설정. While it is not null, the
// settings layer stands in for the library.
export function settingsPage(route: Route): SettingsPage | 'list' | null {
  switch (route.kind) {
    case 'prompts':
    case 'prompt':
      return 'prompts';
    case 'personas':
    case 'persona':
      return 'personas';
    case 'profiles':
    case 'profile':
    case 'model':
      return 'profiles';
    case 'defaults':
    case 'account':
      return route.kind;
    case 'settings':
      return 'list';
    default:
      return listOf(route) ? 'connections' : null;
  }
}

// Which shelf a route is inside: a character's id, null for 캐릭터 없이, or undefined outside every
// shelf. A chat is inside its character's, which only the chat knows; undefined when it is not there.
export function shelfOf(route: Route, chats: ChatShelves): string | null | undefined {
  switch (route.kind) {
    case 'shelf':
    case 'about':
    case 'edit':
    case 'new-chat':
      return route.character;
    case 'chat':
      return chats.get(route.id)?.chat.character;
    default:
      return undefined;
  }
}

// A character's own page: beside its chats where the sidebar shows them, on its own path on phones.
export const characterPage = (character: string, wide: boolean): Route => (wide ? { kind: 'shelf', character } : { kind: 'about', character });

// Picking a character opens its latest chat where the sidebar lists its chats beside it. On phones,
// and for a character with no chat yet, it opens the character's shelf.
export function enterShelf(shelf: Shelf<{ id: string }>, wide: boolean): Route {
  const latest = shelf.chats[0];
  return wide && latest ? { kind: 'chat', id: latest.id } : { kind: 'shelf', character: shelf.id };
}

// Where 뒤로 goes. On wide screens the library's pages show no 뒤로 at all (the sidebar beside them is
// the way back), so only phones use their answer.
export function up(route: Below, wide: boolean, chats: ChatShelves): Route {
  switch (route.kind) {
    case 'gallery':
    case 'shelf':
      return HOME;
    case 'about':
    case 'new-chat':
      return { kind: 'shelf', character: route.character };
    case 'chat': {
      const shelf = shelfOf(route, chats);
      return shelf === undefined ? HOME : { kind: 'shelf', character: shelf };
    }
    case 'edit':
      return characterPage(route.character, wide);
    case 'settings':
      return HOME;
    case 'connections':
    case 'prompts':
    case 'personas':
    case 'profiles':
    case 'defaults':
    case 'account':
      return { kind: 'settings' };
    case 'add-connection':
    case 'connection':
      return { kind: 'connections' };
    case 'connect':
    case 'connect-direct':
      return { kind: 'add-connection' };
    case 'prompt':
      return { kind: 'prompts' };
    case 'persona':
      return { kind: 'personas' };
    case 'profile':
    case 'model':
      return { kind: 'profiles' };
  }
}

// Where 뒤로 goes from a route whose chat, character or connection is not there: the list it would be
// in, past every route that names it.
export const upFromMissing = (route: Route): Route => (route.kind === 'prompt' ? { kind: 'prompts' } : (listOf(route) ?? HOME));

export type Back = { to: Route; label: string };

// 뒤로 is named for where it goes, as the layout shows that place: on phones home is the character list
// and a shelf is a character's chats; on wide screens a shelf is the character's page.
export function backTo(to: Route, wide: boolean): Back {
  switch (to.kind) {
    case 'home':
      return { to, label: wide ? '홈으로' : '목록으로' };
    case 'shelf':
      return { to, label: wide ? '캐릭터' : '채팅 목록' };
    case 'about':
      return { to, label: '캐릭터' };
    default:
      return { to, label: '뒤로' };
  }
}
