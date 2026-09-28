import type { ReactNode } from 'react';
import type { ChatItem } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { ChatScreen } from '../chat/ChatScreen';
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
import { PromptScreen } from '../prompts/PromptScreen';
import { PromptsScreen } from '../prompts/PromptsScreen';
import { useViews } from '../session';
import { Empty, ListDetail, useSplit, useWide } from '../ui';
import { backTo, connectionList, up, upFromMissing, type Below, type Route } from './routes';

// What the item's side of a connection list says before anything is picked from it.
const EMPTY = {
  connections: '연결을 고르면 모델 목록과 사용량이 여기에 보여요.',
  'add-connection': '왼쪽에서 연결할 곳을 고르면 여기서 이어서 연결해요.',
};

// The chat, character or connection a route names is looked up here, so each screen is given what it
// shows, and Missing stands in when that is not there.
export function Page({ route }: { route: Route }) {
  const { chatById, characterById, library, connections, prompts } = useViews();
  const wide = useWide();
  const split = useSplit();

  const back = (at: Below) => backTo(up(at, wide, chatById), wide);
  // On wide screens the sidebar beside the library's pages is their way back.
  const sideBack = (at: Below) => (wide ? null : back(at));
  const missing = (at: Route, what: Absent) => <Missing what={what} back={backTo(upFromMissing(at), wide)} />;
  const withCharacter = (at: Route, id: string, show: (shelf: CharacterShelf<ChatItem>) => ReactNode) => {
    const shelf = characterById.get(id);
    if (shelf) return show(shelf);
    return missing(at, library.deleted.some((candidate) => candidate.id === id) ? 'deleted-character' : 'character');
  };

  function screen(at: Route): ReactNode {
    switch (at.kind) {
      // The desktop home: every character, or before there is one, the first steps (F1).
      case 'home':
        return library.characters.length ? <GalleryScreen back={null} /> : <HomeScreen />;
      case 'gallery':
        return <GalleryScreen back={sideBack(at)} />;
      case 'shelf':
      case 'about':
        if (at.character === null) return <CharacterScreen key="none" shelf={null} back={sideBack(at)} />;
        return withCharacter(at, at.character, (shelf) => <CharacterScreen key={shelf.id} shelf={shelf} back={sideBack(at)} />);
      case 'edit':
        return withCharacter(at, at.character, (shelf) => <CharacterEditScreen key={shelf.id} id={shelf.id} initial={shelf.character.card} back={back(at)} />);
      case 'new-chat':
        if (at.character === null) return <ChatScreen key="new" item={null} shelf={null} back={sideBack(at)} />;
        return withCharacter(at, at.character, (shelf) => <ChatScreen key={`new-${shelf.id}`} item={null} shelf={shelf} back={sideBack(at)} />);
      case 'chat': {
        const item = chatById.get(at.id);
        if (!item) return missing(at, 'chat');
        const { character } = item.chat;
        const shelf = character === null ? null : characterById.get(character);
        // Its character is in 지운 캐릭터, or gone for good.
        if (shelf === undefined) return missing(at, 'orphaned-chat');
        return <ChatScreen key={item.id} item={item} shelf={shelf} back={sideBack(at)} />;
      }
      case 'connections':
        return <ConnectionsScreen back={back(at)} />;
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
        return <PromptsScreen back={back(at)} />;
      case 'prompt': {
        const stored = prompts.find((prompt) => prompt.id === at.id);
        return stored ? <PromptScreen key={stored.id} stored={stored} pane={at.pane} back={back(at)} /> : missing(at, 'prompt');
      }
    }
  }

  // The connection screens as their list and the item picked from it, which sit side by side when
  // there is room (design F5, desktop).
  const list = connectionList(route);
  if (!list) return screen(route);
  const detail = route.kind === list.kind ? null : screen(route);
  if (split) return <ListDetail list={screen(list)} detail={detail ?? <Empty variant="pane">{EMPTY[list.kind]}</Empty>} />;
  return detail ?? screen(list);
}
