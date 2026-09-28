import { MessageSquare, MoreHorizontal, PanelRight } from 'lucide-react';
import { NameDialog } from '../common/NameDialog';
import { SHORTCUT_LIST } from '../shortcuts';
import { Avatar, ChatTitle, Dialog, IconButton, MenuDivider, MenuItem, Popover, Shortcuts } from '../ui';
import { ChatModelMenu } from './ChatModelMenu';
import type { OpenChat } from './useChat';

export function ChatHeading({ chat }: { chat: OpenChat }) {
  const { item, card, shelf, streaming } = chat;
  const title = card ? `${card.name} · ${item?.title ?? '새 채팅'}` : (item?.title ?? '새 채팅');
  const face = card ? <Avatar face={card.name} image={shelf!.face} /> : <Avatar face={MessageSquare} />;
  return <ChatTitle avatar={face} title={title} typing={streaming} />;
}

export function ChatHeaderActions({ chat }: { chat: OpenChat }) {
  const { item, route, panel, pop, actions } = chat;
  const label = 'kind' in route ? '모델 고르기' : route.model.name;
  const current = 'kind' in route ? null : { connection: route.connection.id, model: route.model.id };
  return (
    <>
      <ChatModelMenu open={pop === 'model'} onOpen={(open) => actions.menu(open ? 'model' : null)} current={current} label={label} onPick={actions.pickModel} />
      <IconButton icon={PanelRight} label="답장 정보" size="sm" expanded={panel.open} onClick={() => (panel.open ? actions.closeInfo() : actions.info(null))} />
      <Popover
        open={pop === 'menu'}
        onClose={() => actions.menu(null)}
        place="below-end"
        label="더보기"
        trigger={<IconButton icon={MoreHorizontal} label="더보기" size="sm" expanded={pop === 'menu'} onClick={() => actions.menu(pop === 'menu' ? null : 'menu')} />}
      >
        {item && <MenuItem label="채팅 이름 바꾸기" onClick={() => actions.openDialog('rename')} />}
        <MenuItem label="단축키" onClick={() => actions.openDialog('keys')} />
        {item && (
          <>
            <MenuDivider />
            <MenuItem
              label="이 채팅 삭제"
              tone="warn"
              onClick={() => {
                actions.menu(null);
                void actions.drop();
              }}
            />
          </>
        )}
      </Popover>
    </>
  );
}

export function ChatDialogs({ chat }: { chat: OpenChat }) {
  const { dialog, item, actions } = chat;
  if (dialog === 'keys') {
    return (
      <Dialog title="단축키" note="입력창에서 동작해요. 화살표는 입력창이 비어 있을 때만 써요." onClose={actions.closeDialog}>
        <Shortcuts items={SHORTCUT_LIST} />
      </Dialog>
    );
  }
  if (dialog === 'rename' && item) {
    return <NameDialog title="채팅 이름 바꾸기" value={item.title} hint="비워 두면 첫 메시지로 불러요." onSave={(name) => void actions.rename(name)} onClose={actions.closeDialog} />;
  }
  return null;
}
