import type { CacheDiff } from '../model/cache';

const CELLS = 250_000;

export function cacheDiff(before: string, after: string): CacheDiff {
  if (before === after) return { runs: before ? [{ kind: 'same', text: before }] : [], coarse: false };
  const a = Array.from(before);
  const b = Array.from(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - tail - 1] === b[b.length - tail - 1]) tail++;
  const left = a.slice(head, a.length - tail);
  const right = b.slice(head, b.length - tail);
  const runs: CacheDiff['runs'] = [];
  const push = (kind: CacheDiff['runs'][number]['kind'], text: string) => {
    if (!text) return;
    const last = runs.at(-1);
    if (last?.kind === kind) last.text += text;
    else runs.push({ kind, text });
  };
  push('same', a.slice(0, head).join(''));
  const coarse = left.length > 0 && right.length > 0 && (left.length + 1) * (right.length + 1) > CELLS;
  if (coarse || !left.length || !right.length) {
    push('before', left.join(''));
    push('after', right.join(''));
  } else {
    const width = right.length + 1;
    const table = new Uint32Array((left.length + 1) * width);
    for (let i = left.length - 1; i >= 0; i--) {
      for (let j = right.length - 1; j >= 0; j--) table[i * width + j] = left[i] === right[j] ? 1 + table[(i + 1) * width + j + 1]! : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
    let i = 0;
    let j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) { push('same', left[i++]!); j++; }
      else if (i < left.length && (j === right.length || table[(i + 1) * width + j]! >= table[i * width + j + 1]!)) push('before', left[i++]!);
      else push('after', right[j++]!);
    }
  }
  push('same', a.slice(a.length - tail).join(''));
  return { runs, coarse };
}
