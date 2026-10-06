import { useState, useSyncExternalStore, type ReactNode } from 'react';
import type { Stored } from '../../model/kinds';
import { binsChat, isBinned, live } from '../../model/library';
import { AdminScreen } from '../admin/AdminScreen';
import { ChatScreen, type SideAt } from '../chat/ChatScreen';
import { describeFailure } from '../common/failure';
import { Missing, type Absent } from '../common/Missing';
import { ConnectionAddScreen } from '../connections/ConnectionAddScreen';
import { ConnectionDirectScreen } from '../connections/ConnectionDirectScreen';
import { ConnectionKeyScreen } from '../connections/ConnectionKeyScreen';
import { ConnectionModelsScreen } from '../connections/ConnectionModelsScreen';
import { ConnectionSignInScreen } from '../connections/ConnectionSignInScreen';
import { ConnectionsScreen } from '../connections/ConnectionsScreen';
import { CharacterEditScreen } from '../library/CharacterEditScreen';
import { CharacterScreen } from '../library/CharacterScreen';
import { GalleryScreen } from '../library/gallery/GalleryScreen';
import { HomeScreen } from '../library/HomeScreen';
import { useImport } from '../library/ImportFlow';
import { ModelScreen } from '../models/ModelScreen';
import { ProfileScreen } from '../models/ProfileScreen';
import { ModelsScreen } from '../models/ModelsScreen';
import { ModuleScreen } from '../modules/ModuleScreen';
import { ModulesScreen } from '../modules/ModulesScreen';
import { PersonaScreen } from '../personas/PersonaScreen';
import { PersonasScreen } from '../personas/PersonasScreen';
import { PromptScreen } from '../prompts/PromptScreen';
import { PromptsScreen } from '../prompts/PromptsScreen';
import { useAccount, useCharacter, useChatModel, useChatSummary, useSession, useStored } from '../session';
import { AccountScreen } from '../settings/AccountScreen';
import { ChatSettingsScreen } from '../settings/ChatSettingsScreen';
import { DisplayScreen } from '../settings/DisplayScreen';
import { TranslatorScreen } from '../settings/TranslatorScreen';
import { Button, Empty, ListDetail, NavBar, Progress, Screen, Text, useSplit, useWide } from '../ui';
import { ChatSide } from './ChatSide';
import { backBar } from './router';
import { backTo, listOf, up, upFromMissing, type Back, type Below, type Route } from './routes';
import { SettingsList } from './settings/SettingsNav';

const side = (at: SideAt) => <ChatSide {...at} />;
type At<K extends Route['kind']> = Extract<Route, { kind: K }>;
const missing = (at: Route, what: Absent, wide: boolean) => <Missing what={what} back={backTo(upFromMissing(at), wide)} />;
type ItemKind = 'character' | 'prompt' | 'persona' | 'module' | 'profile';
const absentItem = <K extends ItemKind>(kind: K, stored: Stored<K> | null): K | `deleted-${K}` =>
  stored && isBinned(stored.value) ? `deleted-${kind}` : kind;

const EMPTY = {
  connections: '연결을 고르면 모델 목록과 사용량이 여기에 보여요.',
  'add-connection': '왼쪽에서 연결할 곳을 고르면 여기서 이어서 연결해요.',
  personas: '페르소나를 고르면 여기서 고칠 수 있어요.',
  modules: '모듈을 고르면 담긴 것과 켜는 곳이 여기에 보여요.',
  models: '모델을 고르면 그 모델의 정보와 쓰는 설정이 여기에 보여요.',
};

// The chat, character or connection a route names is looked up here, so each screen is given what it
// shows, and Missing stands in when that is not there.
export function Page({ route, closeSettings }: { route: Route; closeSettings: () => void }) {
  const wide = useWide();
  const split = useSplit();
  const back = (at: Below) => backTo(up(at, wide), wide);
  // On wide screens the sidebar beside the library's pages, or 설정's, is their way back.
  const sideBack = (at: Below) => (wide ? null : back(at));

  function screen(at: Route): ReactNode {
    switch (at.kind) {
      case 'home':
        return <HomePage />;
      case 'gallery':
        return <GalleryScreen back={sideBack(at)} />;
      case 'shelf':
      case 'about':
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
  if (!list) return screen(route);
  const detail = route.kind === list.kind ? null : screen(route);
  if (split) return <ListDetail variant={list.kind === 'personas' ? 'grid' : 'list'} list={screen(list)} detail={detail ?? <Empty variant="pane">{EMPTY[list.kind]}</Empty>} />;
  return detail ?? screen(list);
}

function HomePage() {
  const { read } = useSession();
  const populated = useSyncExternalStore(read.library.subscribe, () => read.library.snapshot().characters.length > 0);
  return populated ? <GalleryScreen back={null} /> : <HomeScreen />;
}

function CharacterPage({ at, wide }: { at: At<'shelf' | 'about' | 'edit'>; wide: boolean }) {
  const shelf = useCharacter(at.character);
  const stored = useStored('character', at.character);
  if (at.character !== null && !shelf) return missing(at, absentItem('character', stored), wide);
  const back = backTo(up(at, wide), wide);
  return at.kind === 'edit'
    ? <CharacterEditScreen key={shelf!.id} id={shelf!.id} character={shelf!.character} back={back} />
    : <CharacterScreen key={shelf?.id ?? 'none'} shelf={shelf} back={wide ? null : back} />;
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
  const back = backTo(up(at, wide, summary?.chat.character), wide);
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
      {chatModel.state === 'failed' ? <Text>{describeFailure(chatModel.error!)}</Text> : <Progress steps={[{ label: '채팅을 불러오는 중' }]} />}
      {chatModel.state === 'failed' && <Button onClick={chatModel.retry}>다시 시도</Button>}
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
