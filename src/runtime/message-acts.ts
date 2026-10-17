import type { ChatItem, Message } from '../model/chat';
import type { ApiResult } from './api';
import { branchChat, copyShown, editMessage, removeMessage, removeMessages, restoreMessage, restoreMessages, selectVersion } from './chat-log';
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

export async function editShown(session: Acting, chat: string, message: Message, text: string, translation: string | null, id?: string) {
  return told(await editMessage(session.store, chat, message, text, translation, id), () => tellAt(session, chat, message.id, 'edit'));
}

export async function pickVersion(session: Acting, chat: string, message: Message, index: number) {
  return told(await selectVersion(session.store, chat, message.id, message.versions[index]!.id), () => tellAt(session, chat, message.id, 'select'));
}

// The version shown changes to the copy, so the tools are told of a switch.
export async function copyVersion(session: Acting, chat: string, message: Message) {
  return told(await copyShown(session.store, chat, message), () => tellAt(session, chat, message.id, 'select'));
}

// The message as it was: read before it goes.
export async function deleteMessage(session: Acting, chat: string, message: Message) {
  const at = session.scripts.at(chat, message.id);
  return told(await removeMessage(session.store, chat, message.id), () => at && session.scripts.changed(chat, { ...at, kind: 'delete' }));
}

export async function undeleteMessage(session: Acting, chat: string, message: Message) {
  return told(await restoreMessage(session.store, chat, message.id), () => tellAt(session, chat, message.id, 'restore'));
}

// A message and every one after it, as one act. Each is told as its own delete, the last first, so every index told
// still stands when it is read.
export async function deleteMessages(session: Acting, chat: string, messages: Message[]) {
  const at = messages.map((message) => session.scripts.at(chat, message.id)).reverse();
  return told(await removeMessages(session.store, chat, messages.map(({ id }) => id)), () => {
    for (const each of at) if (each) session.scripts.changed(chat, { ...each, kind: 'delete' });
  });
}

export async function undeleteMessages(session: Acting, chat: string, messages: Message[]) {
  return told(await restoreMessages(session.store, chat, messages.map(({ id }) => id)), () => {
    for (const { id } of messages) tellAt(session, chat, id, 'restore');
  });
}

export async function branchFrom(session: Acting, item: ChatItem, message: string): Promise<ApiResult<string>> {
  const made = await branchChat(session.store, item, message);
  if (!made.ok) return made;
  const { id, ...from } = made.data;
  session.scripts.branched(id, from);
  return { ok: true, data: id };
}
