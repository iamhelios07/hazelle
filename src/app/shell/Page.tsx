import type { ReactNode } from 'react';
import type { ChatSummary } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { ChatScreen, type SideAt } from '../chat/ChatScreen';
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
import { ModelScreen } from '../models/ModelScreen';
import { ProfileScreen } from '../models/ProfileScreen';
import { ProfilesScreen } from '../models/ProfilesScreen';
import { PersonaScreen } from '../personas/PersonaScreen';
import { PersonasScreen } from '../personas/PersonasScreen';
import { PromptScreen } from '../prompts/PromptScreen';
import { PromptsScreen } from '../prompts/PromptsScreen';
import { useChatModel, useChats, useConnections, useLibrary, usePersonas, useProfiles, usePrompts } from '../session';
import { AccountScreen } from '../settings/AccountScreen';
import { DefaultsScreen } from '../settings/DefaultsScreen';
import { Empty, ListDetail, useSplit, useWide } from '../ui';
import { ChatSide } from './ChatSide';
import { backTo, listOf, up, upFromMissing, type Below, type Route } from './routes';
import { SettingsList } from './settings/SettingsNav';

const side = (at: SideAt) => <ChatSide {...at} />;

// What the item's side of a list says before anything is picked from it.
const EMPTY = {
  connections: '연결을 고르면 모델 목록과 사용량이 여기에 보여요.',
  'add-connection': '왼쪽에서 연결할 곳을 고르면 여기서 이어서 연결해요.',
  personas: '페르소나를 고르면 여기서 고칠 수 있어요.',
  profiles: '모델을 고르면 그 모델의 정보와 쓰는 설정이 여기에 보여요.',
};

// The chat, character or connection a route names is looked up here, so each screen is given what it
// shows, and Missing stands in when that is not there.
export function Page({ route, closeSettings }: { route: Route; closeSettings: () => void }) {
  const chatById = new Map(useChats().map((item) => [item.id, item]));
  const library = useLibrary();
  const characterById = new Map(library.characters.map((shelf) => [shelf.id, shelf]));
  const connections = useConnections();
  const prompts = usePrompts();
  const personas = usePersonas();
  const profiles = useProfiles();
  const chatModel = useChatModel(route.kind === 'chat' ? route.id : null);
  const wide = useWide();
  const split = useSplit();

  const back = (at: Below) => backTo(up(at, wide, chatById), wide);
  // On wide screens the sidebar beside the library's pages, or 설정's, is their way back.
  const sideBack = (at: Below) => (wide ? null : back(at));
  const missing = (at: Route, what: Absent) => <Missing what={what} back={backTo(upFromMissing(at), wide)} />;
  const withCharacter = (at: Route, id: string, show: (shelf: CharacterShelf<ChatSummary>) => ReactNode) => {
    const shelf = characterById.get(id);
    if (shelf) return show(shelf);
    return missing(at, library.deleted.some((candidate) => candidate.id === id) ? 'deleted-character' : 'character');
  };

  function screen(at: Route): ReactNode {
    switch (at.kind) {
      // The desktop home: every character, or before there is one, the first steps.
      case 'home':
        return library.characters.length ? <GalleryScreen back={null} /> : <HomeScreen />;
      case 'gallery':
        return <GalleryScreen back={sideBack(at)} />;
      case 'shelf':
      case 'about':
        if (at.character === null) return <CharacterScreen key="none" shelf={null} back={sideBack(at)} />;
        return withCharacter(at, at.character, (shelf) => <CharacterScreen key={shelf.id} shelf={shelf} back={sideBack(at)} />);
      case 'edit':
        return withCharacter(at, at.character, (shelf) => <CharacterEditScreen key={shelf.id} id={shelf.id} initial={shelf.character} back={back(at)} />);
      case 'new-chat':
        if (at.character === null) return <ChatScreen key="new" item={null} shelf={null} back={sideBack(at)} side={side} />;
        return withCharacter(at, at.character, (shelf) => <ChatScreen key={`new-${shelf.id}`} item={null} shelf={shelf} back={sideBack(at)} side={side} />);
      case 'chat': {
        const item = chatModel;
        if (!item) return missing(at, 'chat');
        const { character } = item.chat;
        const shelf = character === null ? null : characterById.get(character);
        // Its character is in 지운 캐릭터, or gone for good.
        if (shelf === undefined) return missing(at, 'orphaned-chat');
        return <ChatScreen key={item.id} item={item} shelf={shelf} back={sideBack(at)} side={side} />;
      }
      case 'settings':
        return <SettingsList onClose={closeSettings} />;
      case 'connections':
        return <ConnectionsScreen back={sideBack(at)} />;
      case 'add-connection':
        return <ConnectionAddScreen back={back(at)} />;
      case 'connect-direct':
        return <ConnectionDirectScreen address={at.address} back={back(at)} />;
      case 'connect': {
        const { type } = at;
        if (type.signIn) return <ConnectionSignInScreen key={type.id} type={type} signIn={type.signIn} back={back(at)} />;
        return <ConnectionKeyScreen key={type.id} type={type} back={back(at)} />;
      }
      case 'connection': {
        const stored = connections.find((connection) => connection.id === at.id);
        return stored ? <ConnectionModelsScreen key={stored.id} stored={stored} back={back(at)} /> : missing(at, 'connection');
      }
      case 'prompts':
        return <PromptsScreen back={sideBack(at)} />;
      case 'prompt': {
        const stored = prompts.find((prompt) => prompt.id === at.id);
        return stored ? <PromptScreen key={stored.id} stored={stored} pane={at.pane} back={back(at)} /> : missing(at, 'prompt');
      }
      case 'personas':
        return <PersonasScreen back={sideBack(at)} />;
      case 'persona': {
        const stored = personas.find((persona) => persona.id === at.id);
        return stored ? <PersonaScreen key={stored.id} stored={stored} back={back(at)} /> : missing(at, 'persona');
      }
      case 'profiles':
        return <ProfilesScreen back={sideBack(at)} />;
      case 'profile': {
        const stored = profiles.find((profile) => profile.id === at.id);
        return stored ? <ProfileScreen key={stored.id} stored={stored} back={back(at)} /> : missing(at, 'profile');
      }
      case 'model': {
        const connection = connections.find((candidate) => candidate.id === at.connection);
        const model = connection?.value.starred.find((candidate) => candidate.id === at.model);
        return connection && model ? <ModelScreen key={`${connection.id}/${model.id}`} connection={connection} model={model} back={back(at)} /> : missing(at, 'model');
      }
      case 'defaults':
        return <DefaultsScreen back={sideBack(at)} />;
      case 'account':
        return <AccountScreen back={sideBack(at)} />;
    }
  }

  // The connection, persona and 모델 설정 screens: their list and the item picked from it, side by side when there is room.
  const list = listOf(route);
  if (!list) return screen(route);
  const detail = route.kind === list.kind ? null : screen(route);
  if (split) return <ListDetail list={screen(list)} detail={detail ?? <Empty variant="pane">{EMPTY[list.kind]}</Empty>} />;
  return detail ?? screen(list);
}
