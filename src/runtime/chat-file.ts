import { isRecord } from '../connectors/values';
import { entryOrder } from '../model/chat';
import type { Kind, Stored } from '../model/kinds';
import { memoryId } from '../model/memory';
import { fromBase64, toBase64 } from '../vault/aead';
import type { ApiResult } from './api';
import { storedMemory } from './memory-read';
import type { Session } from './session';
import { readRow } from './upgrade';

// version is the format's one version key: a file of any other version is refused, never read as this one. Version 3
// and every later file stays readable: a new stored shape adds a step in runtime/upgrade.ts, never a version bump that
// refuses older files (user ruling 2026-10-10).
const FORMAT = { format: 'hazelle-chat', version: 3 };

// character: the one the chat was with where it was saved, by its id and name there. pictures: each illustration's
// picture by its file id, so the chat's pictures go wherever the file goes.
export type ChatFile = {
  character: { id: string; name: string } | null;
  chat: Stored<'chat'>;
  entries: Stored<'entry'>[];
  memory: Stored<'memory'> | null;
  illustrations: Stored<'illustration'>[];
  pictures: Map<string, Uint8Array<ArrayBuffer>>;
};
export type ChatFileError = 'not-chat-file' | 'other-version';

const decoded = (text: string) => {
  try {
    return fromBase64(text);
  } catch {
    return null;
  }
};

const row = <K extends Kind>({ id, kind, parent, rev, value }: Stored<K>): Stored<K> => ({ id, kind, parent, rev, value });

// One chat as the backup holds it, its summary and streams aside. Entries go in the order they fold here, numbered
// again from 1 with none pending, so the file folds as the screen shows it, writes not yet answered included. An
// illustration whose picture the operator blocked is left out, as a backup leaves it out.
export async function chatFile({ store, files }: Pick<Session, 'store' | 'files'>, id: string): Promise<ApiResult<string>> {
  const chat = store.get('chat', id)!;
  const character = chat.value.character === null ? null : store.get('character', chat.value.character);
  const entries = [...store.children('entry', id)].sort(entryOrder).map((entry, index) => ({ ...row(entry), rev: index + 1 }));
  const memory = storedMemory(store, id);
  const pictures: Record<string, string> = {};
  const illustrations: Stored<'illustration'>[] = [];
  for (const illustration of store.children('illustration', id)) {
    const { file } = illustration.value;
    if (!(file.id in pictures)) {
      const read = await files.read(file);
      if (!read.ok && read.error === 'file-blocked') continue;
      if (!read.ok) return read;
      pictures[file.id] = toBase64(read.data);
    }
    illustrations.push(row(illustration));
  }
  return { ok: true, data: JSON.stringify({ ...FORMAT, character: character && { id: character.id, name: character.value.card.name }, rows: [row(chat), ...entries, ...(memory ? [row(memory)] : []), ...illustrations], pictures }) };
}

// The file comes from outside: every row passes the backup's own check, and one that is not this chat's, or an
// illustration whose picture the file lacks, refuses it.
export function readChatFile(json: unknown): { ok: true; file: ChatFile } | { ok: false; error: ChatFileError } {
  const refused = { ok: false, error: 'not-chat-file' } as const;
  if (!isRecord(json) || json.format !== FORMAT.format) return refused;
  if (json.version !== FORMAT.version) return { ok: false, error: 'other-version' };
  const { character, rows, pictures } = json;
  if (character !== null && !(isRecord(character) && typeof character.id === 'string' && typeof character.name === 'string')) return refused;
  if (!Array.isArray(rows) || !isRecord(pictures)) return refused;
  const read = rows.map(readRow);
  const chats = read.filter((each) => each?.kind === 'chat');
  if (chats.length !== 1) return refused;
  const chat = row(chats[0] as Stored<'chat'>);
  const entries: Stored<'entry'>[] = [];
  const illustrations: Stored<'illustration'>[] = [];
  const bytes = new Map<string, Uint8Array<ArrayBuffer>>();
  let memory: Stored<'memory'> | null = null;
  for (const each of read) {
    if (each === null) return refused;
    if (each.kind === 'chat') continue;
    if (each.parent !== chat.id) return refused;
    if (each.kind === 'entry') entries.push(row(each as Stored<'entry'>));
    else if (each.kind === 'memory' && each.id === memoryId(chat.id) && !memory) memory = row(each as Stored<'memory'>);
    else if (each.kind === 'illustration') {
      const illustration = row(each as Stored<'illustration'>);
      const picture = pictures[illustration.value.file.id];
      const opened = typeof picture === 'string' ? decoded(picture) : null;
      if (!opened) return refused;
      bytes.set(illustration.value.file.id, opened);
      illustrations.push(illustration);
    } else return refused;
  }
  return { ok: true, file: { character: character && { id: character.id as string, name: character.name as string }, chat, entries, memory, illustrations, pictures: bytes } };
}
