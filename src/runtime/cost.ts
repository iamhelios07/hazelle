import { resolveConnection } from '../connectors/registry';
import type { Connection, Cost } from '../connectors/types';
import type { Receipt } from '../model/chat';
import { appendCost } from './chat-log';
import type { ObjectStore } from './store';
import { pause } from './pause';
import { relayJson, type RelayFailure } from './relay';

export type SettleFailure = RelayFailure | { kind: 'not-a-cost' };
export type SettleResult = { ok: true; cost: Cost } | { ok: false; failure: SettleFailure };

// A cost can take a while to be booked, and a lookup before then answers 404. provider-hub found six
// seconds too short, so the waits grow to about a minute in all.
const WAITS_MS = [1000, 2000, 4000, 8000, 15000, 30000];

// For a reply whose cost came back 'pending', with the reply's id.
export async function settleCost(connection: Connection, replyId: string, signal: AbortSignal): Promise<SettleResult> {
  const settle = resolveConnection(connection)?.type?.settle;
  if (!settle) return { ok: false, failure: { kind: 'not-a-cost' } };
  for (let attempt = 0; ; attempt++) {
    const answer = await relayJson(settle.request(connection.secret, replyId), signal);
    if (answer.ok) {
      const cost = settle.parse(answer.data);
      return cost ? { ok: true, cost } : { ok: false, failure: { kind: 'not-a-cost' } };
    }
    const booked = !(answer.failure.kind === 'provider' && answer.failure.status === 404);
    if (booked || attempt === WAITS_MS.length) return answer;
    if (!(await pause(WAITS_MS[attempt]!, signal))) return { ok: false, failure: { kind: 'stopped' } };
  }
}

export class Costs {
  private readonly abort = new AbortController();
  private readonly settling = new Set<string>();

  constructor(private readonly store: ObjectStore) {}

  // Asked again when a reply shows 확인 중 after a reload, since the page that wrote it may have closed before
  // the cost came.
  settle(chat: string, receipt: Receipt) {
    const connection = this.store.get('connection', receipt.connection);
    if (this.abort.signal.aborted || receipt.cost !== 'pending' || !receipt.replyId || !connection || this.settling.has(receipt.replyId)) return;
    const replyId = receipt.replyId;
    this.settling.add(replyId);
    void settleCost(connection.value, replyId, this.abort.signal)
      .then(async (settled) => {
        if (this.abort.signal.aborted) return;
        await appendCost(this.store, chat, replyId, settled.ok ? settled.cost : null);
      })
      .finally(() => this.settling.delete(replyId));
  }

  close() {
    this.abort.abort();
  }
}
