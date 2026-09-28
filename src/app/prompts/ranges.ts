import type { Block, ChatRange, ChatSlot } from '../../model/prompt';

// Where a range starts and ends in a chat of `length` messages, as a slice reads it: negative counts from the end.
function span({ from, to }: ChatRange, length: number): [number, number] {
  const at = (index: number) => Math.min(length, Math.max(0, index < 0 ? length + index : index));
  return [at(from), to === null ? length : at(to)];
}

// What the 채팅 slots together leave out or send twice, in words, or null when every message goes once. It is read
// on a chat long enough that the ranges counted from the start and from the end do not meet, so what it says holds
// for every longer chat.
export function chatWarning(blocks: readonly Block[]): string | null {
  const ranges = blocks.filter((block): block is ChatSlot => block.kind === 'slot' && block.slot === 'chat').map((block) => block.range);
  if (ranges.length === 0) return '‘채팅’ 자리가 없어서 주고받은 메시지가 하나도 들어가지 않아요.';
  const reach = Math.max(...ranges.flatMap(({ from, to }) => [Math.abs(from), Math.abs(to ?? 0)]));
  const length = 2 * reach + 2;
  const sent = new Array<number>(length).fill(0);
  for (const range of ranges) {
    const [start, end] = span(range, length);
    for (let index = start; index < end; index++) sent[index]! += 1;
  }
  if (sent.some((times) => times > 1)) return '같은 메시지가 두 번 들어가요. ‘채팅’ 자리들의 범위가 겹쳐요.';
  const missed: string[] = [];
  let index = 0;
  while (index < length) {
    if (sent[index]) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < length && !sent[index]) index += 1;
    missed.push(describeRun(start, index - 1, length, reach));
  }
  return missed.length ? `${missed.join(', ')}이(가) 어느 ‘채팅’ 자리에도 들어가지 않아요.` : null;
}

// A run of messages no slot sends, named from the end of the chat when the ranges place it there.
function describeRun(first: number, last: number, length: number, reach: number): string {
  if (first === 0) return '앞부분';
  const fromEnd = (index: number) => length - index;
  const nearEnd = first >= length - reach;
  if (last === length - 1) return !nearEnd ? '뒷부분' : first === last ? '마지막 메시지' : `마지막 ${fromEnd(first)}개`;
  if (!nearEnd) return '중간 메시지';
  return first === last ? `끝에서 ${fromEnd(first)}번째 메시지` : `끝에서 ${fromEnd(last)}~${fromEnd(first)}번째 메시지`;
}
