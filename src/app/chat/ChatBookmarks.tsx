import { useMemo, useState } from 'react';
import { previewLine, shown } from '../../model/chat';
import { versionTree } from '../../runtime/chat-log';
import { ACTS } from '../common/acts';
import { NameDialog } from '../common/NameDialog';
import { BOOKMARK } from '../common/words';
import { useSession } from '../session';
import { Empty, List, ListItem, MenuItem, MoreMenu, SidePanel, useWide } from '../ui';
import { bookmarkRows, type BookmarkRow } from './bookmarks';
import { speaker } from './ChatMessage';
import { speakers } from './ChatLog';
import type { OpenChat } from './useChat';

export function ChatBookmarks({ id, chat }: { id: string; chat: OpenChat }) {
  const { store } = useSession();
  const { item, messages, texts, actions } = chat;
  const wide = useWide();
  const [naming, setNaming] = useState<BookmarkRow | null>(null);
  const tree = useMemo(() => versionTree(store, id), [item?.messages]);
  const rows = bookmarkRows(item?.chat.bookmarks ?? [], tree);
  const { character, me, modelName } = speakers(chat);
  // Off the line shown, a message has no displayed text: its stored one stands in, as in the version switcher.
  const start = ({ message }: BookmarkRow) => {
    const at = messages.findIndex((each) => each.id === message.id);
    return previewLine(at === -1 ? shown(message).text : texts[at]!);
  };

  // A narrow panel covers the story, so it steps aside for the message it points at.
  function show(row: BookmarkRow) {
    if (actions.showBookmark(row) && !wide) actions.closePanel();
  }

  return (
    <SidePanel title={BOOKMARK} onClose={actions.closePanel}>
      {rows.length ? (
        <List label={BOOKMARK}>
          {rows.map((row) => {
            const who = speaker(row.message, character, me, modelName);
            return (
              <ListItem
                key={row.message.id}
                title={row.name ?? who}
                description={row.name ? `${who} · ${start(row)}` : start(row)}
                tags={row.to.length ? ['다른 버전'] : []}
                onClick={() => show(row)}
                control={
                  <MoreMenu of={BOOKMARK}>
                    <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={() => setNaming(row)} />
                    <MenuItem label={`${BOOKMARK} 해제`} onClick={() => actions.bookmark(row.message.id)} />
                  </MoreMenu>
                }
              />
            );
          })}
        </List>
      ) : (
        <Empty variant="section">북마크한 메시지가 없어요.</Empty>
      )}
      {naming && (
        <NameDialog
          title={`${BOOKMARK} ${ACTS.rename.label}`}
          value={naming.name ?? ''}
          hint="비워 두면 말한 사람으로 표시돼요."
          onSave={(name) => {
            actions.renameBookmark(naming.message.id, name);
            setNaming(null);
          }}
          onClose={() => setNaming(null)}
        />
      )}
    </SidePanel>
  );
}
