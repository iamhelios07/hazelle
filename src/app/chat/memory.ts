import type { Fact, MemoryRecord, Source } from '../../model/memory';
import type { RecordStatus } from '../../runtime/memory';

export const STATUS_WORDS: Record<RecordStatus, string> = { sent: '보냄', stale: '원문 바뀜', over: '예산 넘음', forgotten: '지움' };

export const recordTitle = (record: MemoryRecord) => record.what.trim() || '내용 없는 기록';

export const recordScene = (record: MemoryRecord) => [record.when, record.where].filter(Boolean).join(' · ');

export class MessagePositions {
  private messages: readonly { id: string }[] | undefined;
  private places: ReadonlyMap<string, number> = new Map();

  read(messages: readonly { id: string }[]): ReadonlyMap<string, number> {
    if (messages === this.messages) return this.places;
    this.messages = messages;
    // Streamed text and version changes do not move a source; only message identity and order invalidate the index.
    if (messages.length !== this.places.size || messages.some(({ id }, at) => this.places.get(id) !== at)) {
      this.places = new Map(messages.map(({ id }, at) => [id, at]));
    }
    return this.places;
  }
}

// A record's messages as the chat shows them now, counted from 1: the ones still there, to jump to, and how many are
// gone, which a deletion leaves until the user decides.
export function spanOf(sources: readonly Source[], positions: ReadonlyMap<string, number>): { words: string; there: string[] } {
  const there: string[] = [];
  let from = Infinity;
  let to = -Infinity;
  for (const { message } of sources) {
    const at = positions.get(message);
    if (at === undefined) continue;
    there.push(message);
    from = Math.min(from, at + 1);
    to = Math.max(to, at + 1);
  }
  const gone = sources.length - there.length;
  if (there.length === 0) return { words: `지운 메시지 ${gone}개`, there };
  const span = from === to ? `${from}번째 메시지` : `메시지 ${from}–${to}`;
  return { words: gone ? `${span} · 지운 메시지 ${gone}개` : span, there };
}

export function factGroups(state: readonly Fact[]): { about: string; facts: Fact[] }[] {
  const groups = new Map<string, Fact[]>();
  for (const fact of state) groups.set(fact.about, [...(groups.get(fact.about) ?? []), fact]);
  return [...groups].map(([about, facts]) => ({ about, facts }));
}
