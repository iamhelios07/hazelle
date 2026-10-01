import type { Fact, MemoryRecord, Source } from '../../model/memory';
import type { RecordStatus } from '../../runtime/memory';

export const STATUS_WORDS: Record<RecordStatus, string> = { sent: '보냄', stale: '원문 바뀜', over: '예산 넘음', forgotten: '지움' };

export const recordTitle = (record: MemoryRecord) => record.what.trim() || '내용 없는 기록';

// When and where, as the story says them.
export const recordScene = (record: MemoryRecord) => [record.when, record.where].filter(Boolean).join(' · ');

// A record's messages as the chat shows them now, counted from 1: the ones still there, to jump to, and how many are
// gone, which a deletion leaves until the user decides.
export function spanOf(sources: readonly Source[], messages: readonly { id: string }[]): { words: string; there: string[] } {
  const places = sources.map(({ message }) => messages.findIndex(({ id }) => id === message)).filter((at) => at !== -1);
  const gone = sources.length - places.length;
  if (places.length === 0) return { words: `지운 메시지 ${gone}개`, there: [] };
  const from = Math.min(...places) + 1;
  const to = Math.max(...places) + 1;
  const span = from === to ? `${from}번째 메시지` : `메시지 ${from}–${to}`;
  return { words: gone ? `${span} · 지운 메시지 ${gone}개` : span, there: places.map((at) => messages[at]!.id) };
}

// The state's facts by whom or what they concern, in the order each first appears.
export function factGroups(state: readonly Fact[]): { about: string; facts: Fact[] }[] {
  const groups = new Map<string, Fact[]>();
  for (const fact of state) groups.set(fact.about, [...(groups.get(fact.about) ?? []), fact]);
  return [...groups].map(([about, facts]) => ({ about, facts }));
}
