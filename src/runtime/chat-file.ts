import { isRecord } from '../connectors/values';
import { entryOrder } from '../model/chat';
import type { Kind, Stored } from '../model/kinds';
import { memoryId } from '../model/memory';
import type { ObjectStore } from './store';
import { readRow } from './upgrade';

// version is the format's one version key: a file of any other version is refused, never read as this one.
const FORMAT = { format: 'hazelle-chat', version: 1 };

// character: the one the chat was with where it was saved, by its id and name there.
export type ChatFile = { character: { id: string; name: string } | null; chat: Stored<'chat'>; entries: Stored<'entry'>[]; memory: Stored<'memory'> | null };
export type ChatFileError = 'not-chat-file' | 'other-version';

const row = <K extends Kind>({ id, kind, parent, rev, value }: Stored<K>): Stored<K> => ({ id, kind, parent, rev, value });

// One chat as the backup holds it, its summary and streams aside. Entries go in the order they fold here, numbered
// again from 1 with none pending, so the file folds as the screen shows it, writes not yet answered included.
export function chatFile(store: Pick<ObjectStore, 'get' | 'children'>, id: string): string {
  const chat = store.get('chat', id)!;
  const character = chat.value.character === null ? null : store.get('character', chat.value.character);
  const entries = [...store.children('entry', id)].sort(entryOrder).map((entry, index) => ({ ...row(entry), rev: index + 1 }));
  const memory = store.children('memory', id).find((each) => each.id === memoryId(id));
  return JSON.stringify({ ...FORMAT, character: character && { id: character.id, name: character.value.card.name }, rows: [row(chat), ...entries, ...(memory ? [row(memory)] : [])] });
}

// The file comes from outside: every row passes the backup's own check, and one that is not this chat's refuses it.
export function readChatFile(json: unknown): { ok: true; file: ChatFile } | { ok: false; error: ChatFileError } {
  const refused = { ok: false, error: 'not-chat-file' } as const;
  if (!isRecord(json) || json.format !== FORMAT.format) return refused;
  if (json.version !== FORMAT.version) return { ok: false, error: 'other-version' };
  const { character, rows } = json;
  if (character !== null && !(isRecord(character) && typeof character.id === 'string' && typeof character.name === 'string')) return refused;
  if (!Array.isArray(rows)) return refused;
  const read = rows.map(readRow);
  const chats = read.filter((each) => each?.kind === 'chat');
  if (chats.length !== 1) return refused;
  const chat = row(chats[0] as Stored<'chat'>);
  const entries: Stored<'entry'>[] = [];
  let memory: Stored<'memory'> | null = null;
  for (const each of read) {
    if (each === null) return refused;
    if (each.kind === 'chat') continue;
    if (each.parent !== chat.id) return refused;
    if (each.kind === 'entry') entries.push(row(each as Stored<'entry'>));
    else if (each.kind === 'memory' && each.id === memoryId(chat.id) && !memory) memory = row(each as Stored<'memory'>);
    else return refused;
  }
  return { ok: true, file: { character: character && { id: character.id as string, name: character.name as string }, chat, entries, memory } };
}
