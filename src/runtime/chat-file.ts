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

// character: the one the chat was with where it was saved, by its id and name there. pictures: each illustration's and
// inlay's picture by its file id, so the chat's pictures go wherever the file goes.
export type ChatFile = {
  character: { id: string; name: string } | null;
  chat: Stored<'chat'>;
  entries: Stored<'entry'>[];
  memory: Stored<'memory'> | null;
  illustrations: Stored<'illustration'>[];
  inlays: Stored<'inlay'>[];
  lore: Stored<'lore'>[];
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

const PICTURED = ['illustration', 'inlay'] as const;

// One chat as the backup holds it, its summary and streams aside. Entries go in the order they fold here, numbered
// again from 1 with none pending, so the file folds as the screen shows it, writes not yet answered included. A
// picture the operator blocked is left out with its row, as a backup leaves it out.
export async function chatFile({ store, files }: Pick<Session, 'store' | 'files'>, id: string): Promise<ApiResult<string>> {
  const chat = store.get('chat', id)!;
  const character = chat.value.character === null ? null : store.get('character', chat.value.character);
  const entries = [...store.children('entry', id)].sort(entryOrder).map((entry, index) => ({ ...row(entry), rev: index + 1 }));
  const memory = storedMemory(store, id);
  const lore = store.children('lore', id).map(row);
  const pictures: Record<string, string> = {};
  const pictured: Stored<(typeof PICTURED)[number]>[] = [];
  for (const each of PICTURED.flatMap((kind) => store.children(kind, id))) {
    const { file } = each.value;
    if (!(file.id in pictures)) {
      const read = await files.read(file);
      if (!read.ok && read.error === 'file-blocked') continue;
      if (!read.ok) return read;
      pictures[file.id] = toBase64(read.data);
    }
    pictured.push(row(each));
  }
  return { ok: true, data: JSON.stringify({ ...FORMAT, character: character && { id: character.id, name: character.value.card.name }, rows: [row(chat), ...entries, ...(memory ? [row(memory)] : []), ...pictured, ...lore], pictures }) };
}

// The file comes from outside: every row passes the backup's own check, and one that is not this chat's, or an
// illustration or inlay whose picture the file lacks, refuses it. A file written before inlays or 채팅 로어북 has none.
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
  const inlays: Stored<'inlay'>[] = [];
  const lore: Stored<'lore'>[] = [];
  const bytes = new Map<string, Uint8Array<ArrayBuffer>>();
  let memory: Stored<'memory'> | null = null;
  for (const each of read) {
    if (each === null) return refused;
    if (each.kind === 'chat') continue;
    if (each.parent !== chat.id) return refused;
    if (each.kind === 'entry') entries.push(row(each as Stored<'entry'>));
    else if (each.kind === 'lore') lore.push(row(each as Stored<'lore'>));
    else if (each.kind === 'memory' && each.id === memoryId(chat.id) && !memory) memory = row(each as Stored<'memory'>);
    else if (each.kind === 'illustration' || each.kind === 'inlay') {
      const { file } = (each as Stored<(typeof PICTURED)[number]>).value;
      const picture = pictures[file.id];
      const opened = typeof picture === 'string' ? decoded(picture) : null;
      if (!opened) return refused;
      bytes.set(file.id, opened);
      if (each.kind === 'illustration') illustrations.push(row(each as Stored<'illustration'>));
      else inlays.push(row(each as Stored<'inlay'>));
    } else return refused;
  }
  return { ok: true, file: { character: character && { id: character.id as string, name: character.name as string }, chat, entries, memory, illustrations, inlays, lore, pictures: bytes } };
}
