import { GitBranch, History, List, MessageSquare, MoreHorizontal, PanelRight, Pencil, Plus, SlidersHorizontal } from 'lucide-react';
import { branchTree } from '../../model/chat';
import { NameDialog } from '../common/NameDialog';
import { ago } from '../common/time';
import { useLibrary, useRemembering } from '../session';
import { navigate } from '../shell/router';
import { runShortcut } from '../shortcuts';
import { Avatar, ChatTitle, Divider, IconButton, Menu, MenuHeading, MenuItem, ToolButton, useWide } from '../ui';
import { ChatModelMenu } from './ChatModelMenu';
import { ChatPromptMenu } from './ChatPromptMenu';
import { ReadingDialog, ReadingMenu, type ReadingControl } from './ChatReading';
import type { OpenChat } from './useChat';

export function ChatHeading({ chat }: { chat: OpenChat }) {
  const { item, card, shelf, streaming } = chat;
  const title = card ? `${card.name} · ${item?.title ?? '새 채팅'}` : (item?.title ?? '새 채팅');
  const face = card ? <Avatar face={card.name} image={shelf!.face} /> : <Avatar face={MessageSquare} />;
  return (
    <Menu label={card ? `${card.name}의 채팅` : '캐릭터 없이'} size="lg" trigger={(opener) => <ChatTitle avatar={face} title={title} typing={streaming} {...opener} />}>
      <ChatChoices chat={chat} />
    </Menu>
  );
}

// A character can hold hundreds of chats, so the menu lists only the latest; the rest are on the character's chat list.
const RECENT = 8;

// Mounted only while the menu is open.
function ChatChoices({ chat }: { chat: OpenChat }) {
  const { id, shelf, actions } = chat;
  const { none } = useLibrary();
  const chats = shelf?.chats ?? none.chats;
  return (
    <>
      <MenuItem icon={Plus} label="새 채팅" onClick={() => navigate({ kind: 'new-chat', character: shelf?.id ?? null })} />
      {shelf && <MenuItem icon={Pencil} label="캐릭터 편집" onClick={() => actions.side({ kind: 'character', id: shelf.id })} />}
      {chats.length > 0 && (
        <>
          <Divider variant="menu" />
          <MenuHeading>최근 채팅</MenuHeading>
        </>
      )}
      {branchTree(chats.slice(0, RECENT)).map(({ item, nested }) => (
        <MenuItem
          key={item.id}
          icon={nested ? GitBranch : undefined}
          label={item.title}
          sub={item.at === null ? `메시지 ${item.count}개` : `메시지 ${item.count}개 · ${ago(item.at)}`}
          checked={item.id === id}
          onClick={() => navigate({ kind: 'chat', id: item.id })}
        />
      ))}
      {chats.length > RECENT && <MenuItem icon={List} label={`채팅 ${chats.length}개 모두 보기`} onClick={() => navigate({ kind: 'shelf', character: shelf?.id ?? null })} />}
    </>
  );
}

export function ChatHeaderActions({ chat, reading }: { chat: OpenChat; reading: ReadingControl }) {
  const { id, item, route, toggles, panel, modelMenu, actions } = chat;
  const remembering = useRemembering();
  const failed = id !== null && remembering.failed.has(id);
  const toggleMemory = () => (panel?.kind === 'memory' ? actions.closePanel() : actions.memory(null));
  const wide = useWide();
  const label = 'kind' in route ? '모델 고르기' : route.model.name;
  const current = 'kind' in route ? null : { connection: route.connection.id, model: route.model.id };
  return (
    <>
      <ChatPromptMenu chat={chat} />
      <ChatModelMenu handle={modelMenu} current={current} label={label} onPick={actions.pickModel} />
      <ToolButton
        icon={SlidersHorizontal}
        label="토글"
        detail={toggles.changed ? `처음 값과 다른 것 ${toggles.changed}개` : undefined}
        mark={{ kind: 'count', count: toggles.changed }}
        phone="icon"
        expanded={panel?.kind === 'toggles'}
        onClick={() => (panel?.kind === 'toggles' ? actions.closePanel() : actions.showToggles())}
      />
      {/* A phone's header has no room left beside the chat's title, so there 장기 기억 and 읽기 설정 open from ⋯. */}
      {wide && item && (
        <ToolButton
          icon={History}
          label="장기 기억"
          detail={failed ? '마지막 정리가 실패했어요' : undefined}
          mark={failed ? { kind: 'dot' } : undefined}
          expanded={panel?.kind === 'memory'}
          onClick={toggleMemory}
        />
      )}
      {wide && <ReadingMenu reading={reading} />}
      {/* A phone opens 정보 from a tapped message's tools. */}
      {wide && (
        <IconButton
          icon={PanelRight}
          label="답장 정보"
          size="sm"
          expanded={panel?.kind === 'info'}
          onClick={() => (panel?.kind === 'info' ? actions.closePanel() : actions.info(null))}
        />
      )}
      <Menu place="below-end" label="더보기" trigger={(opener) => <IconButton icon={MoreHorizontal} label="더보기" size="sm" {...opener} />}>
        {item && <MenuItem label="채팅 이름 바꾸기" onClick={() => actions.openDialog('rename')} />}
        {!wide && item && <MenuItem label="장기 기억" sub={failed ? '마지막 정리가 실패했어요' : undefined} onClick={toggleMemory} />}
        {!wide && <MenuItem label="읽기 설정" onClick={() => actions.openDialog('reading')} />}
        <MenuItem label="단축키" onClick={() => runShortcut('shortcutList')} />
        {item && (
          <>
            <Divider variant="menu" />
            <MenuItem label="이 채팅 지우기" tone="warn" onClick={() => void actions.drop()} />
          </>
        )}
      </Menu>
    </>
  );
}

export function ChatDialogs({ chat, reading }: { chat: OpenChat; reading: ReadingControl }) {
  const { dialog, item, actions } = chat;
  if (dialog === 'reading') return <ReadingDialog reading={reading} onClose={actions.closeDialog} />;
  if (dialog === 'rename' && item) {
    return <NameDialog title="채팅 이름 바꾸기" value={item.title} hint="비워 두면 첫 메시지로 불러요." onSave={(name) => void actions.rename(name)} onClose={actions.closeDialog} />;
  }
  return null;
}
