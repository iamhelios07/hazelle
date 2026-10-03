import type { HistoryMessage } from '../history';

export type PreviousMessages = Record<HistoryMessage['role'], Int32Array>;

export function previousMessages(messages: readonly HistoryMessage[]): PreviousMessages {
  const previous = { user: new Int32Array(messages.length + 1), assistant: new Int32Array(messages.length + 1) };
  let user = -1;
  let assistant = -1;
  for (let before = 0; before <= messages.length; before++) {
    previous.user[before] = user;
    previous.assistant[before] = assistant;
    if (messages[before]?.role === 'user') user = before;
    else if (before < messages.length) assistant = before;
  }
  return previous;
}
