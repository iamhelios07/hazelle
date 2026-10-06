import { History, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { NameDialog } from '../common/NameDialog';
import { CAST } from '../common/words';
import { useRemembering } from '../session';
import { navigate } from '../shell/router';
import { runShortcut } from '../shortcuts';
import { ChatTitle, Divider, IconButton, Menu, MenuItem, ToolButton, useMenuOpener, useWide } from '../ui';
import { ChatCastMenu } from './ChatCastMenu';
import { ChatModelMenu } from './ChatModelMenu';
import { ChatPromptMenu } from './ChatPromptMenu';
import { ReadingDialog, ReadingMenu } from './ChatReading';
import type { OpenChat } from './useChat';

// Wide screens name the character in the sidebar beside the chat, whose title opens it; the header names only the chat.
export function ChatHeading({ chat }: { chat: OpenChat }) {
  const { item, card, shelf, busy, actions } = chat;
  const wide = useWide();
  const name = item?.title ?? '새 채팅';
  if (wide) return <ChatTitle name={name} typing={busy} />;
  return <ChatTitle name={card?.name ?? '캐릭터 없이'} sub={name} typing={busy} onClick={shelf ? () => actions.side({ kind: 'character', id: shelf.id, part: null }) : undefined} />;
}

export function ChatHeaderActions({ chat }: { chat: OpenChat }) {
  const { id, item, shelf, cast, route, toggles, panel, modelMenu, castMenu, actions } = chat;
  const remembering = useRemembering();
  const failed = id !== null && remembering.failed.has(id);
  const toggleMemory = () => (panel?.kind === 'memory' ? actions.closePanel() : actions.memory(null));
  const wide = useWide();
  const openCast = useMenuOpener(castMenu);
  const label = 'kind' in route ? '모델 선택' : route.model.name;
  const current = 'kind' in route ? null : { connection: route.connection.id, model: route.model.id };
  return (
    <>
      <ChatPromptMenu chat={chat} />
      <ChatCastMenu chat={chat} button={wide} />
      <ChatModelMenu handle={modelMenu} current={current} label={label} onPick={actions.pickModel} />
      <ToolButton
        icon={SlidersHorizontal}
        label="토글"
        detail={toggles.changed ? `변경 ${toggles.changed}개` : undefined}
        mark={{ kind: 'count', count: toggles.changed }}
        phone="icon"
        expanded={panel?.kind === 'toggles'}
        onClick={() => (panel?.kind === 'toggles' ? actions.closePanel() : actions.showToggles())}
      />
      {/* A phone's header has no room left beside the chat's title, so there 등장인물, 장기 기억 and 읽기 설정 open from ⋯. */}
      {wide && item && (
        <ToolButton
          icon={History}
          label="장기 기억"
          detail={failed ? '정리 실패' : undefined}
          mark={failed ? { kind: 'dot' } : undefined}
          expanded={panel?.kind === 'memory'}
          onClick={toggleMemory}
        />
      )}
      {wide && <ReadingMenu />}
      <Menu place="below-end" label="더보기" trigger={(opener) => <IconButton icon={MoreHorizontal} label="더보기" size="sm" {...opener} />}>
        {!wide && <MenuItem label="새 채팅" onClick={() => navigate({ kind: 'new-chat', character: shelf?.id ?? null })} />}
        {!wide && <MenuItem label={CAST} sub={cast.length ? `${cast.length}명` : undefined} onClick={openCast.onClick} />}
        {item && <MenuItem label="채팅 이름 바꾸기" onClick={() => actions.openDialog('rename')} />}
        {!wide && item && <MenuItem label="장기 기억" sub={failed ? '정리 실패' : undefined} onClick={toggleMemory} />}
        {!wide && <MenuItem label="읽기 설정" onClick={() => actions.openDialog('reading')} />}
        {!wide && <MenuItem label="검색" onClick={actions.openSearch} />}
        <MenuItem label="단축키" onClick={() => runShortcut('shortcutList')} />
        {item && (
          <>
            <Divider variant="menu" />
            <MenuItem label="이 채팅 삭제" tone="warn" onClick={actions.drop} />
          </>
        )}
      </Menu>
    </>
  );
}

export function ChatDialogs({ chat }: { chat: OpenChat }) {
  const { dialog, item, actions } = chat;
  if (dialog === 'reading') return <ReadingDialog onClose={actions.closeDialog} />;
  if (dialog === 'rename' && item) {
    return <NameDialog title="채팅 이름 바꾸기" value={item.title} hint="비워 두면 첫 메시지로 표시돼요." onSave={actions.rename} onClose={actions.closeDialog} />;
  }
  return null;
}
