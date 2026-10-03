import type { HistoryMessage } from '../history';

type Matches = { through: number; found: { at: number; text: string }[] };

// Risu copied from the previous same-role message only, and carried a match forward because the output stage
// rewrote that message in storage. Stored text stays as written, so the index reads raw history instead.
export class RepeatMatches {
  private readonly messages: readonly HistoryMessage[];
  private readonly fixed = new Map<string, Matches>();
  private readonly dynamic = new Map<string, Matches>();

  constructor(messages: readonly HistoryMessage[]) {
    this.messages = messages;
  }

  find(pattern: RegExp, index: number, dynamic: boolean): string | null {
    const role = this.messages[index]!.role;
    const key = JSON.stringify([pattern.source, pattern.flags, role]);
    const cache = dynamic ? this.dynamic : this.fixed;
    let state = cache.get(key);
    if (!state) state = { through: 0, found: [] };
    cache.delete(key);
    cache.set(key, state);
    // CBS may produce a different pattern for every message. Its cache must not retain a history per expansion.
    if (dynamic && cache.size > 16) cache.delete(cache.keys().next().value!);
    for (; state.through < index; state.through++) {
      const message = this.messages[state.through]!;
      if (message.role !== role) continue;
      pattern.lastIndex = 0;
      const match = pattern.exec(message.text);
      if (match) state.found.push({ at: state.through, text: match[0] });
    }
    let low = 0;
    let high = state.found.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (state.found[middle]!.at < index) low = middle + 1;
      else high = middle;
    }
    return low === 0 ? null : state.found[low - 1]!.text;
  }
}
