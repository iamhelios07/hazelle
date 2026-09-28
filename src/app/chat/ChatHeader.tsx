import { MessageSquare, MoreHorizontal, PanelRight, SlidersHorizontal } from 'lucide-react';
import { NameDialog } from '../common/NameDialog';
import { SHORTCUTS } from '../shortcuts';
import { Avatar, ChatTitle, Dialog, Divider, IconButton, Menu, MenuItem, Shortcuts, ToolButton, useWide } from '../ui';
import { ChatModelMenu } from './ChatModelMenu';
import { ChatPromptMenu } from './ChatPromptMenu';
import type { OpenChat } from './useChat';

export function ChatHeading({ chat }: { chat: OpenChat }) {
  const { item, card, shelf, streaming } = chat;
  const title = card ? `${card.name} · ${item?.title ?? '새 채팅'}` : (item?.title ?? '새 채팅');
  const face = card ? <Avatar face={card.name} image={shelf!.face} /> : <Avatar face={MessageSquare} />;
  return <ChatTitle avatar={face} title={title} typing={streaming} />;
}

export function ChatHeaderActions({ chat }: { chat: OpenChat }) {
  const { item, route, toggles, panel, modelMenu, actions } = chat;
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
      {/* design F3: a phone opens 정보 from a tapped message's tools. */}
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
        <MenuItem label="단축키" onClick={() => actions.openDialog('keys')} />
        {item && (
          <>
            <Divider variant="menu" />
            <MenuItem label="이 채팅 삭제" tone="warn" onClick={() => void actions.drop()} />
          </>
        )}
      </Menu>
    </>
  );
}

export function ChatDialogs({ chat }: { chat: OpenChat }) {
  const { dialog, item, actions } = chat;
  if (dialog === 'keys') {
    return (
      <Dialog title="단축키" note="입력창에서 동작해요. 화살표는 입력창이 비어 있을 때만 써요." onClose={actions.closeDialog}>
        <Shortcuts items={Object.values(SHORTCUTS)} />
      </Dialog>
    );
  }
  if (dialog === 'rename' && item) {
    return <NameDialog title="채팅 이름 바꾸기" value={item.title} hint="비워 두면 첫 메시지로 불러요." onSave={(name) => void actions.rename(name)} onClose={actions.closeDialog} />;
  }
  return null;
}
