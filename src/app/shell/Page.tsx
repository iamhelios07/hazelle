import { MessageSquarePlus } from 'lucide-react';
import { lazy, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Stored } from '../../model/kinds';
import { binsChat, isBinned, live } from '../../model/library';
import type { SideAt } from '../chat/ChatScreen';
import { ACTS } from '../common/acts';
import { personaFaces } from '../common/alias';
import { describeFailure } from '../common/failure';
import { Missing, type Absent } from '../common/Missing';
import { ScreenLoad } from '../common/ScreenLoad';
import { findStarred } from '../common/RolePicker';
import { NO_CHARACTER } from '../common/words';
import { useImport } from '../library/ImportFlow';
import { useAccount, useCharacter, useChatModel, useChatSummary, useConnections, useModules, usePersonas, useSession, useSettings, useStored } from '../session';
import { Button, Callout, Empty, Intro, ListDetail, NavBar, Progress, Screen, useSplit, useWide } from '../ui';
import { backBar, navigate } from './router';
import { backTo, listOf, up, upFromMissing, type Back, type Below, type Route } from './routes';
import { SettingsList } from './settings/SettingsNav';

type ListKind = NonNullable<ReturnType<typeof listOf>>['kind'];

const ToolPageScreen = lazy(() => import('../modules/ToolPageScreen').then(({ ToolPageScreen }) => ({ default: ToolPageScreen })));
const AdminScreen = lazy(() => import('../admin/AdminScreen').then(({ AdminScreen }) => ({ default: AdminScreen })));
const ChatScreen = lazy(() => import('../chat/ChatScreen').then(({ ChatScreen }) => ({ default: ChatScreen })));
const ConnectionAddScreen = lazy(() => import('../connections/ConnectionAddScreen').then(({ ConnectionAddScreen }) => ({ default: ConnectionAddScreen })));
const ConnectionDirectScreen = lazy(() => import('../connections/ConnectionDirectScreen').then(({ ConnectionDirectScreen }) => ({ default: ConnectionDirectScreen })));
const ConnectionKeyScreen = lazy(() => import('../connections/ConnectionKeyScreen').then(({ ConnectionKeyScreen }) => ({ default: ConnectionKeyScreen })));
const ConnectionModelsScreen = lazy(() => import('../connections/ConnectionModelsScreen').then(({ ConnectionModelsScreen }) => ({ default: ConnectionModelsScreen })));
const ConnectionSignInScreen = lazy(() => import('../connections/ConnectionSignInScreen').then(({ ConnectionSignInScreen }) => ({ default: ConnectionSignInScreen })));
const ConnectionsScreen = lazy(() => import('../connections/ConnectionsScreen').then(({ ConnectionsScreen }) => ({ default: ConnectionsScreen })));
const CharacterEditScreen = lazy(() => import('../library/CharacterEditScreen').then(({ CharacterEditScreen }) => ({ default: CharacterEditScreen })));
const GalleryScreen = lazy(() => import('../library/gallery/GalleryScreen').then(({ GalleryScreen }) => ({ default: GalleryScreen })));
const HomeScreen = lazy(() => import('../library/HomeScreen').then(({ HomeScreen }) => ({ default: HomeScreen })));
const ModelScreen = lazy(() => import('../models/ModelScreen').then(({ ModelScreen }) => ({ default: ModelScreen })));
const ProfileScreen = lazy(() => import('../models/ProfileScreen').then(({ ProfileScreen }) => ({ default: ProfileScreen })));
const ModelsScreen = lazy(() => import('../models/ModelsScreen').then(({ ModelsScreen }) => ({ default: ModelsScreen })));
const ModuleScreen = lazy(() => import('../modules/ModuleScreen').then(({ ModuleScreen }) => ({ default: ModuleScreen })));
const ModulesScreen = lazy(() => import('../modules/ModulesScreen').then(({ ModulesScreen }) => ({ default: ModulesScreen })));
const PersonaScreen = lazy(() => import('../personas/PersonaScreen').then(({ PersonaScreen }) => ({ default: PersonaScreen })));
const PersonasScreen = lazy(() => import('../personas/PersonasScreen').then(({ PersonasScreen }) => ({ default: PersonasScreen })));
const PromptScreen = lazy(() => import('../prompts/PromptScreen').then(({ PromptScreen }) => ({ default: PromptScreen })));
const PromptsScreen = lazy(() => import('../prompts/PromptsScreen').then(({ PromptsScreen }) => ({ default: PromptsScreen })));
const AccountScreen = lazy(() => import('../settings/AccountScreen').then(({ AccountScreen }) => ({ default: AccountScreen })));
const ChatSettingsScreen = lazy(() => import('../settings/ChatSettingsScreen').then(({ ChatSettingsScreen }) => ({ default: ChatSettingsScreen })));
const DisplayScreen = lazy(() => import('../settings/DisplayScreen').then(({ DisplayScreen }) => ({ default: DisplayScreen })));
const TranslatorScreen = lazy(() => import('../settings/TranslatorScreen').then(({ TranslatorScreen }) => ({ default: TranslatorScreen })));
const ChatSide = lazy(() => import('./ChatSide').then(({ ChatSide }) => ({ default: ChatSide })));

const side = (at: SideAt) => <ScreenLoad><ChatSide {...at} /></ScreenLoad>;
type At<K extends Route['kind']> = Extract<Route, { kind: K }>;
const missing = (at: Route, what: Absent, wide: boolean) => <Missing what={what} back={backTo(upFromMissing(at), wide)} />;
type ItemKind = 'character' | 'prompt' | 'persona' | 'module' | 'profile';
const absentItem = <K extends ItemKind>(kind: K, stored: Stored<K> | null): K | `deleted-${K}` =>
  stored && isBinned(stored.value) ? `deleted-${kind}` : kind;

const EMPTY = {
  connections: '연결을 선택해 주세요.',
  'add-connection': '연결할 제공자를 선택해 주세요.',
  personas: '페르소나를 선택해 주세요.',
  modules: '모듈을 선택해 주세요.',
  models: '모델을 선택해 주세요.',
};

// The chat, character or connection a route names is looked up here, so each screen is given what it
// shows, and Missing stands in when that is not there.
export function Page({ route, closeSettings }: { route: Route; closeSettings: () => void }) {
  const wide = useWide();
  const split = useSplit();
  const back = (at: Below) => backTo(up(at), wide);
  // On wide screens the sidebar beside the library's pages, or 설정's, is their way back.
  const sideBack = (at: Below) => (wide ? null : back(at));

  function screen(at: Route): ReactNode {
    switch (at.kind) {
      case 'home':
        return <HomePage />;
      case 'gallery':
        return <GalleryScreen back={sideBack(at)} />;
      case 'shelf':
      case 'edit':
        return <CharacterPage at={at} wide={wide} />;
      case 'new-chat':
      case 'chat':
        return <ChatPage at={at} wide={wide} />;
      case 'settings':
        return <SettingsList onClose={closeSettings} />;
      case 'connections':
        return <ConnectionsScreen back={sideBack(at)} />;
      case 'add-connection':
        return <ConnectionAddScreen back={back(at)} />;
      case 'connect-direct':
        return <ConnectionDirectScreen key={at.address} address={at.address} back={back(at)} />;
      case 'connect': {
        const { type } = at;
        if (type.signIn) return <ConnectionSignInScreen key={type.id} type={type} signIn={type.signIn} back={back(at)} />;
        return <ConnectionKeyScreen key={type.id} type={type} back={back(at)} />;
      }
      case 'connection':
        return <ConnectionPage at={at} back={back(at)} />;
      case 'prompts':
        return <PromptsScreen back={sideBack(at)} />;
      case 'prompt':
        return <ItemPage at={at} back={back(at)}>{(stored) => <PromptScreen key={stored.id} stored={stored} pane={at.pane} back={back(at)} />}</ItemPage>;
      case 'personas':
        return <PersonasScreen back={sideBack(at)} />;
      case 'persona':
        return <ItemPage at={at} back={back(at)}>{(stored) => <PersonaScreen key={stored.id} stored={stored} back={back(at)} />}</ItemPage>;
      case 'modules':
        return <ModulesPage back={sideBack(at)} />;
      case 'module':
        return <ItemPage at={at} back={back(at)}>{(stored) => <ModuleScreen key={stored.id} stored={stored} back={back(at)} />}</ItemPage>;
      case 'tool-page':
        return <ItemPage at={{ kind: 'module', id: at.module }} back={backTo({ kind: 'modules' }, wide)}>{(stored) => <ToolPageScreen key={stored.id} stored={stored} back={back(at)} />}</ItemPage>;
      case 'models':
        return <ModelsScreen back={sideBack(at)} />;
      case 'profile':
        return <ItemPage at={at} back={back(at)}>{(stored) => <ProfileScreen key={stored.id} stored={stored} back={back(at)} />}</ItemPage>;
      case 'model':
        return <ModelPage at={at} back={back(at)} />;
      case 'account':
        return <AccountScreen section={at.section} back={sideBack(at)} />;
      case 'chat-settings':
        return <ChatSettingsScreen back={sideBack(at)} />;
      case 'display':
        return <DisplayScreen back={sideBack(at)} />;
      case 'translator':
        return <TranslatorScreen back={sideBack(at)} />;
      // Its path can be typed by anyone; the server refuses every call but the operator's.
      case 'admin':
        return <AdminPage back={sideBack(at)} closeSettings={closeSettings} />;
    }
  }

  const list = listOf(route);
  if (!list) return <ScreenLoad>{screen(route)}</ScreenLoad>;
  const detail = route.kind === list.kind ? null : screen(route);
  const empty = <Landing kind={list.kind} />;
  // One boundary for the pair, so a first visit shows one loader, and one inside for the detail alone.
  if (split) return <ScreenLoad><ListDetail variant={list.kind === 'personas' ? 'grid' : 'list'} list={screen(list)} detail={<ScreenLoad>{detail ?? empty}</ScreenLoad>} /></ScreenLoad>;
  return <ScreenLoad>{detail ?? screen(list)}</ScreenLoad>;
}

// Beside its list, a page opens on what it is about: 모델 on the 대화 모델, API 연결 on its connection (else the first),
// 페르소나 on the current persona, 모듈 on the first. The pane stays empty only while there is none. Replaced before paint, so the empty pane never
// shows and 뒤로 does not land on it again.
function Landing({ kind }: { kind: ListKind }) {
  const { models: { main }, persona } = useSettings();
  const connections = useConnections();
  const personas = usePersonas();
  const modules = useModules();
  useLayoutEffect(() => {
    const used = main && findStarred(main, connections) ? main : null;
    const landing = landingOf(kind, { main: used, connection: used?.connection ?? connections[0]?.id, persona: personas.some(({ id }) => id === persona) ? persona : personaFaces(personas)[0]?.persona.id, module: modules[0]?.id });
    if (landing) navigate(landing, { replace: true });
  }, [kind, main, persona, connections, personas, modules]);
  return <Empty variant="pane">{EMPTY[kind]}</Empty>;
}

type Firsts = { main: { connection: string; model: string } | null; connection?: string; persona?: string; module?: string };
function landingOf(kind: ListKind, first: Firsts): Route | null {
  switch (kind) {
    case 'models':
      return first.main && { kind: 'model', connection: first.main.connection, model: first.main.model };
    case 'connections':
      return first.connection ? { kind: 'connection', id: first.connection } : null;
    case 'personas':
      return first.persona ? { kind: 'persona', id: first.persona } : null;
    case 'modules':
      return first.module ? { kind: 'module', id: first.module } : null;
    case 'add-connection':
      return null;
  }
}

function HomePage() {
  const { read } = useSession();
  const populated = useSyncExternalStore(read.library.subscribe, () => read.library.snapshot().characters.length > 0);
  return populated ? <GalleryScreen back={null} /> : <HomeScreen />;
}

function CharacterPage({ at, wide }: { at: At<'shelf' | 'edit'>; wide: boolean }) {
  const shelf = useCharacter(at.character);
  const stored = useStored('character', at.character);
  if (at.character === null) return (
    <Screen align="center">
      <Intro title={NO_CHARACTER} />
      <Button icon={MessageSquarePlus} onClick={() => navigate({ kind: 'new-chat', character: null })}>새 채팅</Button>
    </Screen>
  );
  if (!shelf) return missing(at, absentItem('character', stored), wide);
  return <CharacterEditScreen key={shelf.id} shelf={shelf} back={wide ? null : backTo(up(at), wide)} />;
}

function ChatPage({ at, wide }: { at: At<'new-chat' | 'chat'>; wide: boolean }) {
  const stored = useStored('chat', at.kind === 'chat' ? at.id : null);
  const summary = useChatSummary(at.kind === 'chat' ? at.id : null);
  const chatModel = useChatModel(at.kind === 'chat' ? at.id : null);
  const character = at.kind === 'new-chat' ? at.character : stored?.value.character;
  const shelf = useCharacter(character ?? null);
  const characterStored = useStored('character', character ?? null);
  // The id a new chat is shown under and then saved under, so its greeting's pick and rollp tags keep their rolls. Its
  // screen is keyed by it, so when the first send saves it and the route becomes the chat's, the same screen stays and
  // the story is not drawn again. Any other route drops it, so a later 새 채팅 never takes an id already spent.
  // Both routes stay under this same component boundary; splitting them would remount the screen on its first save.
  const [fresh, setFresh] = useState<{ character: string | null; id: string } | null>(null);
  let newChat = fresh;
  if (at.kind === 'new-chat' ? fresh?.character !== at.character : fresh !== null) {
    newChat = at.kind === 'new-chat' ? { character: at.character, id: crypto.randomUUID() } : null;
    setFresh(newChat);
  }
  const back = backTo(up(at, summary?.chat.character), wide);
  if (at.kind === 'new-chat') {
    if (at.character !== null && !shelf) return missing(at, absentItem('character', characterStored), wide);
    return <ChatScreen key={newChat!.id} id={newChat!.id} item={null} shelf={shelf} back={wide ? null : back} side={side} />;
  }
  if (!summary) {
    return missing(at, stored && binsChat(stored.value, () => shelf !== null) ? 'deleted-chat' : 'chat', wide);
  }
  const item = chatModel.model;
  if (!item || chatModel.state !== 'loaded') return (
    <Screen align="center" top={<NavBar title={summary.title} {...backBar(back)} />}>
      {chatModel.state === 'failed' ? (
        <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: chatModel.retry }}>
          {describeFailure(chatModel.error!)}
        </Callout>
      ) : (
        <Progress steps={[{ label: '채팅을 불러오는 중' }]} />
      )}
    </Screen>
  );
  if (character !== null && !shelf) return missing(at, 'orphaned-chat', wide);
  return <ChatScreen key={item.id} id={item.id} item={item} shelf={shelf} back={wide ? null : back} side={side} />;
}

function ItemPage<K extends 'prompt' | 'persona' | 'module' | 'profile'>({ at, back, children }: { at: { kind: K; id: string }; back: Back; children: (stored: Stored<K>) => ReactNode }) {
  const stored = useStored(at.kind, at.id);
  const shown = live(stored);
  if (!shown) return <Missing what={absentItem(at.kind, stored)} back={back} />;
  return children(shown);
}

function ConnectionPage({ at, back }: { at: At<'connection'>; back: Back }) {
  const stored = useStored('connection', at.id);
  return stored ? <ConnectionModelsScreen key={stored.id} stored={stored} back={back} /> : <Missing what="connection" back={back} />;
}

function ModelPage({ at, back }: { at: At<'model'>; back: Back }) {
  const connection = useStored('connection', at.connection);
  const model = connection?.value.starred.find((candidate) => candidate.id === at.model);
  return connection && model ? <ModelScreen key={`${connection.id}/${model.id}`} connection={connection} model={model} back={back} /> : <Missing what="model" back={back} />;
}

function ModulesPage({ back }: { back: Back | null }) {
  const { pick } = useImport();
  return <ModulesScreen back={back} onImport={pick} />;
}

function AdminPage({ back, closeSettings }: { back: Back | null; closeSettings: () => void }) {
  const { admin } = useAccount();
  return admin ? <AdminScreen back={back} /> : <SettingsList onClose={closeSettings} />;
}
