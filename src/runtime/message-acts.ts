import type { ChatItem, Message } from '../model/chat';
import type { ApiResult } from './api';
import { branchChat, editMessage, removeMessage, restoreMessage, selectVersion } from './chat-log';
import type { Session } from './session';

// The user's own acts on a chat's messages, each told to the chat's tools once it is saved (Hazelle change and branch
// events). A script's writes, another device's and 다시 생성 (a reply event) tell nothing here.

type Acting = Pick<Session, 'store' | 'scripts'>;

const told = <T>(saved: ApiResult<T>, tell: () => void): ApiResult<T> => {
  if (saved.ok) tell();
  return saved;
};

const tellAt = ({ scripts }: Acting, chat: string, message: string, kind: Hazelle.Change['kind']) => {
  const at = scripts.at(chat, message);
  if (at) scripts.changed(chat, { ...at, kind });
};

export async function editShown(session: Acting, chat: string, message: Message, text: string, translation: string | null) {
  return told(await editMessage(session.store, chat, message, text, translation), () => tellAt(session, chat, message.id, 'edit'));
}

export async function pickVersion(session: Acting, chat: string, message: Message, index: number) {
  return told(await selectVersion(session.store, chat, message.id, message.versions[index]!.id), () => tellAt(session, chat, message.id, 'select'));
}

// The message as it was: read before it goes.
export async function deleteMessage(session: Acting, chat: string, message: Message) {
  const at = session.scripts.at(chat, message.id);
  return told(await removeMessage(session.store, chat, message.id), () => at && session.scripts.changed(chat, { ...at, kind: 'delete' }));
}

export async function undeleteMessage(session: Acting, chat: string, message: Message) {
  return told(await restoreMessage(session.store, chat, message.id), () => tellAt(session, chat, message.id, 'restore'));
}

export async function branchFrom(session: Acting, item: ChatItem, message: string): Promise<ApiResult<string>> {
  const made = await branchChat(session.store, item, message);
  if (!made.ok) return made;
  const { id, ...from } = made.data;
  session.scripts.branched(id, from);
  return { ok: true, data: id };
}
