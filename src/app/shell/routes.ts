import { CONNECTION_TYPES } from '../../connectors/registry';
import type { ConnectionType } from '../../connectors/types';
import { SHARE_ID } from '../../contracts/shares';
import type { Shelf } from '../../model/library';

const ACCOUNT_SECTIONS = ['notices', 'news'] as const;
export type AccountSection = (typeof ACCOUNT_SECTIONS)[number];

// These paths are what a reload, a bookmark and the browser's back button land on, so an existing one never changes.
export type Route =
  | { kind: 'home' }
  | { kind: 'gallery'; place: string | null }
  // character null is 캐릭터 없이.
  | { kind: 'shelf'; character: string | null }
  | { kind: 'edit'; character: string }
  | { kind: 'new-chat'; character: string | null }
  | { kind: 'chat'; id: string }
  | { kind: 'connections' }
  | { kind: 'add-connection' }
  | { kind: 'connect'; type: ConnectionType }
  // '' when there was none.
  | { kind: 'connect-direct'; address: string }
  | { kind: 'connection'; id: string }
  // pane opens the editor on its 토글 pane, which the chat's toggle panel links to; a module's, its 토글 page.
  | { kind: 'prompts' }
  | { kind: 'prompt'; id: string; pane: 'toggles' | null }
  | { kind: 'personas' }
  | { kind: 'persona'; id: string }
  | { kind: 'modules' }
  | { kind: 'module'; id: string; pane: 'toggles' | null }
  | { kind: 'tool-page'; module: string }
  | { kind: 'models' }
  | { kind: 'profile'; id: string }
  // model: a starred model's id, which may hold any character; the path carries it escaped.
  | { kind: 'model'; connection: string; model: string }
  // section opens the page at 운영자가 보낸 알림 or 새 소식, which the toasts saying they came link to.
  | { kind: 'account'; section: AccountSection | null }
  | { kind: 'usage' }
  | { kind: 'chat-settings' }
  | { kind: 'display' }
  | { kind: 'translator' }
  | { kind: 'labs' }
  | { kind: 'admin' }
  // 헤이젤로 가져오기 from a share link (library/ShareArrival); its key waits in common/sharePending, never in the path.
  | { kind: 'share'; id: string }
  | { kind: 'settings' };

export const HOME: Route = { kind: 'home' };
// 캐릭터 둘러보기's place: a folder's id, BIN_PLACE for 휴지통, or null for the top (실험실 탐색기식 폴더 only).
export const BIN_PLACE = 'bin';

type Kind<K extends Route['kind']> = Extract<Route, { kind: K }>;
export type Below = Exclude<Route, Kind<'home'>>;

const ID = /^[0-9a-f-]{36}$/;
const NONE = 'none';
// Before the connection type ids, so a type can never take over 직접 연결's path.
const DIRECT = 'direct';

// at is a path with its query, as href writes it. Any other path is home, since the app has no page for it.
export function parseRoute(at: string): Route {
  const query = at.indexOf('?');
  const path = query < 0 ? at : at.slice(0, query);
  const params = new URLSearchParams(query < 0 ? '' : at.slice(query));
  const [top, id, sub, ...rest] = path.slice(1).split('/');
  // A model id's own slashes stay path separators: Cloudflare's asset handler redirects an escaped one (%2F) to a bare one.
  if (top === 'models' && id !== undefined && sub !== undefined) {
    const model = decoded([sub, ...rest]);
    return ID.test(id) && model ? { kind: 'model', connection: id, model } : HOME;
  }
  if (rest.length > 0) return HOME;
  if (top === 'characters') {
    if (id === undefined) {
      const place = params.get('in');
      return { kind: 'gallery', place: place !== null && (place === BIN_PLACE || ID.test(place)) ? place : null };
    }
    if (id === NONE) return sub === undefined ? { kind: 'shelf', character: null } : HOME;
    if (!ID.test(id)) return HOME;
    if (sub === undefined) return { kind: 'shelf', character: id };
    // The character's page before its editor took that place.
    if (sub === 'edit' || sub === 'about') return { kind: 'edit', character: id };
    if (sub === 'new') return { kind: 'new-chat', character: id };
    return HOME;
  }
  if (top === 's' && id !== undefined && sub === undefined) return SHARE_ID.test(id) ? { kind: 'share', id } : HOME;
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
    if (sub === DIRECT) return { kind: 'connect-direct', address: params.get('address') ?? '' };
    const type = CONNECTION_TYPES.find((candidate) => candidate.id === sub);
    return type ? { kind: 'connect', type } : HOME;
  }
  if (top === 'prompts') {
    if (id === undefined) return { kind: 'prompts' };
    if (!ID.test(id) || sub !== undefined) return HOME;
    return { kind: 'prompt', id, pane: params.get('pane') === 'toggles' ? 'toggles' : null };
  }
  if (top === 'personas' && sub === undefined) {
    if (id === undefined) return { kind: 'personas' };
    return ID.test(id) ? { kind: 'persona', id } : HOME;
  }
  if (top === 'modules') {
    if (id === undefined) return { kind: 'modules' };
    if (!ID.test(id)) return HOME;
    if (sub === 'page') return { kind: 'tool-page', module: id };
    return sub === undefined ? { kind: 'module', id, pane: params.get('pane') === 'toggles' ? 'toggles' : null } : HOME;
  }
  if (top === 'models') {
    if (id === undefined) return { kind: 'models' };
    return ID.test(id) ? { kind: 'profile', id } : HOME;
  }
  if (id === undefined) {
    if (top === 'settings') return { kind: 'settings' };
    if (top === 'account') return { kind: 'account', section: ACCOUNT_SECTIONS.find((section) => section === params.get('section')) ?? null };
  }
  if (top === 'account' && id === 'usage' && sub === undefined) return { kind: 'usage' };
  if (top === 'settings' && id === 'chat' && sub === undefined) return { kind: 'chat-settings' };
  if (top === 'settings' && id === 'display' && sub === undefined) return { kind: 'display' };
  if (top === 'settings' && id === 'translator' && sub === undefined) return { kind: 'translator' };
  if (top === 'settings' && id === 'labs' && sub === undefined) return { kind: 'labs' };
  if (top === 'settings' && id === 'admin' && sub === undefined) return { kind: 'admin' };
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
      return route.place === null ? '/characters' : `/characters?in=${route.place}`;
    case 'shelf':
      return `/characters/${route.character ?? NONE}`;
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
    case 'modules':
      return '/modules';
    case 'module':
      return `/modules/${route.id}${route.pane ? `?pane=${route.pane}` : ''}`;
    case 'tool-page':
      return `/modules/${route.module}/page`;
    case 'models':
      return '/models';
    case 'profile':
      return `/models/${route.id}`;
    case 'model':
      return `/models/${route.connection}/${route.model.split('/').map(encodeURIComponent).join('/')}`;
    case 'account':
      return `/account${route.section ? `?section=${route.section}` : ''}`;
    case 'usage':
      return '/account/usage';
    case 'chat-settings':
      return '/settings/chat';
    case 'display':
      return '/settings/display';
    case 'translator':
      return '/settings/translator';
    case 'labs':
      return '/settings/labs';
    case 'admin':
      return '/settings/admin';
    case 'share':
      return `/s/${route.id}`;
    case 'settings':
      return '/settings';
  }
}

export const sidebarPage = (route: Route) => route.kind === 'home' || route.kind === 'shelf';

// null outside the connection, persona, module and 모델 screens.
// A module's editor is a page of its own, never beside the list.
export function listOf(route: Route): Kind<'connections' | 'add-connection' | 'personas' | 'models'> | null {
  switch (route.kind) {
    case 'connections':
    case 'connection':
      return { kind: 'connections' };
    case 'personas':
    case 'persona':
      return { kind: 'personas' };
    case 'models':
    case 'profile':
    case 'model':
      return { kind: 'models' };
    case 'add-connection':
    case 'connect':
    case 'connect-direct':
      return { kind: 'add-connection' };
    default:
      return null;
  }
}

export type SettingsPage = 'models' | 'connections' | 'chat' | 'prompts' | 'personas' | 'modules' | 'display' | 'translator' | 'labs' | 'account' | 'admin';

// 'list' for 설정's own list, or null outside 설정. While it is not null, the settings layer stands in for the library.
export function settingsPage(route: Route): SettingsPage | 'list' | null {
  switch (route.kind) {
    case 'prompts':
    case 'prompt':
      return 'prompts';
    case 'personas':
    case 'persona':
      return 'personas';
    case 'modules':
    case 'module':
    case 'tool-page':
      return 'modules';
    case 'models':
    case 'profile':
    case 'model':
      return 'models';
    case 'account':
    case 'display':
    case 'translator':
    case 'labs':
    case 'admin':
      return route.kind;
    case 'usage':
      return 'account';
    case 'chat-settings':
      return 'chat';
    case 'settings':
      return 'list';
    default:
      return listOf(route) ? 'connections' : null;
  }
}

// Which shelf a route is inside: a character's id, null for 캐릭터 없이, or undefined outside every
// shelf. A chat is inside its character's, which only the chat knows; undefined when it is not there.
export function shelfOf(route: Route, chatShelf?: string | null): string | null | undefined {
  switch (route.kind) {
    case 'shelf':
    case 'edit':
    case 'new-chat':
      return route.character;
    case 'chat':
      return chatShelf;
    default:
      return undefined;
  }
}

export const characterPage = (character: string, wide: boolean): Route => (wide ? { kind: 'shelf', character } : { kind: 'edit', character });

export function enterShelf(shelf: Shelf<{ id: string }>, wide: boolean): Route {
  const latest = shelf.chats[0];
  return wide && latest ? { kind: 'chat', id: latest.id } : { kind: 'shelf', character: shelf.id };
}

// On wide screens the library's pages show no 뒤로 at all (the sidebar beside them is the way back), so only phones
// use their answer.
export function up(route: Below, chatShelf?: string | null): Route {
  switch (route.kind) {
    // The route does not know a folder's parent: ← from inside one goes to the top, browser back a level.
    case 'gallery':
      return route.place === null ? HOME : { kind: 'gallery', place: null };
    case 'shelf':
      return HOME;
    case 'edit':
    case 'new-chat':
      return { kind: 'shelf', character: route.character };
    case 'chat': {
      const shelf = shelfOf(route, chatShelf);
      return shelf === undefined ? HOME : { kind: 'shelf', character: shelf };
    }
    case 'settings':
    case 'share':
      return HOME;
    case 'connections':
    case 'prompts':
    case 'personas':
    case 'modules':
    case 'models':
    case 'account':
    case 'chat-settings':
    case 'display':
    case 'translator':
    case 'labs':
    case 'admin':
      return { kind: 'settings' };
    case 'usage':
      return { kind: 'account', section: null };
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
    case 'module':
      return route.pane ? { ...route, pane: null } : { kind: 'modules' };
    case 'tool-page':
      return { kind: 'module', id: route.module, pane: null };
    case 'profile':
    case 'model':
      return { kind: 'models' };
  }
}

export const upFromMissing = (route: Route): Route => (route.kind === 'tool-page' ? { kind: 'modules' } : route.kind === 'prompt' ? { kind: 'prompts' } : (listOf(route) ?? HOME));

export type Back = { to: Route; label: string };

// 뒤로 is named for where it goes, as the layout shows that place: on phones home is the character list. Only phones
// go back to a shelf, a character's chats.
export function backTo(to: Route, wide: boolean): Back {
  switch (to.kind) {
    case 'home':
      return { to, label: wide ? '홈으로' : '목록으로' };
    case 'shelf':
      return { to, label: '채팅 목록' };
    default:
      return { to, label: '뒤로' };
  }
}
