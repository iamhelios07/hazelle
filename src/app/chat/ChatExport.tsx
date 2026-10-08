import { Download } from 'lucide-react';
import type { ChatItem } from '../../model/chat';
import { chatFile } from '../../runtime/chat-file';
import { download } from '../common/download';
import { CHAT_FILE, EXPORT } from '../common/words';
import { useStore } from '../session';
import { Button, Dialog, Text } from '../ui';
import type { OpenChat } from './useChat';

// What no file system takes in a name.
const UNSAFE = /[\\/:*?"<>|\p{Cc}]/gu;
const fileNamed = (title: string, extension: string) => `${title.replace(UNSAFE, '').trim() || '채팅'}.${extension}`;

export function ChatExport({ chat, item }: { chat: OpenChat; item: ChatItem }) {
  const store = useStore();
  const save = () => download(fileNamed(item.title, 'json'), new Blob([chatFile(store, item.id)], { type: 'application/json' }));
  return (
    <Dialog title={EXPORT} onClose={chat.actions.closeDialog} actions={<Button icon={Download} onClick={save}>저장</Button>}>
      <Text>{`${CHAT_FILE}로 저장해요.`}</Text>
    </Dialog>
  );
}
