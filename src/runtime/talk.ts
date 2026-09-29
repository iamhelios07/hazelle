import type { ModelSettings } from '../connectors/settings';
import type { Assembled } from '../engine/pipeline';
import type { Message, Receipt, ReceiptError } from '../model/chat';
import type { ApiFailure } from './api';
import type { Route, RouteFailure } from './assignment';
import { appendCost, appendReply, appendUserMessage, type Said, type Written } from './chat-log';
import { settleCost } from './cost';
import type { Credentials } from './credential';
import { generate, type Reply } from './generate';
import type { ObjectStore } from './store';

// The reply being written. said is the user's message sent with it, shown until the store has it; reply
// says where the answer goes: a new message, or a new version of one (in place of a failed one on 다시 시도, or
// of the cut one it continues on 이어 쓰기). A continuation's text starts as the text it continues.
export type Turn = {
  chat: string;
  said: { id: string; text: string } | null;
  reply: { id: string; message: string | null; replaces: string | null; continues: { text: string; receipt: Receipt; seed: string } | null };
  text: string;
};

// A message on screen: live marks the version being written.
export type Shown = Message & { live: string | null };

// What one reply is sent with, ready once its prompt is built (runtime/turn): the model and the prompt, which
// the reply's id seeds (engine/pipeline). settings: the model's 설정 묶음 as stored, which the request fits to the model.
// said: the user's message as it is saved, which a message sent translated saves translated (design §6.3).
export type Ask = { route: Route; settings: ModelSettings; prompt: Assembled; said: Said | null };

// What one reply sent, for 정보's 요청 원문 and lorebook part (design F3). It lives in page memory only, until the
// session closes (tech-spec §5: the raw request is not stored).
export type Sent = { request: Reply['request']; prompt: Assembled };

// unsent: the user's message was not saved, so its reply was stopped. unsaved: the reply was written
// but not saved; saveAgain tries once more.
export type TalkFailure = RouteFailure | { kind: 'unsent'; failure: ApiFailure } | { kind: 'unsaved'; failure: ApiFailure };

// The chat's messages with the turn laid over them, until its entries are saved.
export function withTurn(messages: Message[], turn: Turn | null, chat: string): Shown[] {
  const out = messages.map((message) => ({ ...message, live: null as string | null }));
  if (turn?.chat !== chat) return out;
  const { said, reply } = turn;
  if (said && !out.some((message) => message.id === said.id)) {
    out.push({ id: said.id, role: 'user', at: Date.now(), versions: [{ id: said.id, seed: said.id, text: said.text, receipt: null, edited: false, at: Date.now() }], selected: 0, live: null });
  }
  const version = { id: reply.id, seed: reply.continues?.seed ?? reply.id, text: turn.text, receipt: null, edited: false, at: Date.now() };
  if (reply.message === null) {
    if (!out.some((message) => message.id === reply.id)) out.push({ id: reply.id, role: 'assistant', at: Date.now(), versions: [version], selected: 0, live: reply.id });
    return out;
  }
  const index = out.findIndex((message) => message.id === reply.message);
  const message = out[index];
  if (!message || message.versions.some((existing) => existing.id === reply.id)) return out;
  const slot = reply.replaces === null ? -1 : message.versions.findIndex((existing) => existing.id === reply.replaces);
  const versions = slot === -1 ? [...message.versions, version] : message.versions.with(slot, version);
  out[index] = { ...message, versions, selected: slot === -1 ? versions.length - 1 : slot, live: reply.id };
  return out;
}

// One reply is written at a time, app-wide, and it outlives the screen that asked for it: leaving a
// chat does not stop its reply. close() stops everything, for a locked vault. What to ask and where it
// goes come from runtime/turn.
export class Talk {
  private turn: Turn | null = null;
  private abort: AbortController | null = null;
  private unsaved: { chat: string; reply: Written } | null = null;
  private readonly lookups = new AbortController();
  private readonly settling = new Set<string>();
  private readonly listeners = new Set<() => void>();
  // By the id of the version each reply wrote.
  private readonly sentBy = new Map<string, Sent>();

  constructor(
    private readonly store: ObjectStore,
    private readonly credentials: Credentials,
  ) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = () => this.turn;

  // null: not written by this page since the session opened, or written as another version (an edit).
  sent(version: string): Sent | null {
    return this.sentBy.get(version) ?? null;
  }

  stop() {
    this.abort?.abort();
  }

  close() {
    this.stop();
    this.lookups.abort();
    this.sentBy.clear();
  }

  // A reply whose save failed is kept in memory for one more try.
  async saveAgain(): Promise<TalkFailure | null> {
    const unsaved = this.unsaved;
    if (!unsaved) return null;
    const saved = await appendReply(this.store, unsaved.chat, unsaved.reply);
    if (!saved.ok) return { kind: 'unsaved', failure: saved };
    this.unsaved = null;
    this.settle(unsaved.chat, unsaved.reply.receipt);
    return null;
  }

  // Looks up a cost the provider books after the reply. Asked again when a reply shows 확인 중 after a
  // reload, since the page that wrote it may have closed before the cost came.
  settle(chat: string, receipt: Receipt) {
    const connection = this.store.get('connection', receipt.connection);
    if (receipt.cost !== 'pending' || !receipt.replyId || !connection || this.settling.has(receipt.replyId)) return;
    const replyId = receipt.replyId;
    this.settling.add(replyId);
    void settleCost(connection.value, replyId, this.lookups.signal).then(async (settled) => {
      if (this.lookups.signal.aborted) return;
      await appendCost(this.store, chat, replyId, settled.ok ? settled.cost : null);
      this.settling.delete(replyId);
    });
  }

  private set(turn: Turn | null) {
    this.turn = turn;
    for (const listener of this.listeners) listener();
  }

  // The turn is shown before prepare, which may save a new chat, translate the user's message and builds the prompt,
  // so the user's message appears the moment it is sent; stop() stops prepare too. A failure prepare returns ends the
  // turn unsent.
  async run<F extends { kind: string }>({ chat, said, reply }: Omit<Turn, 'text'>, prepare: (signal: AbortSignal) => Promise<Ask | F>): Promise<TalkFailure | F | null> {
    if (this.turn) return null;
    this.set({ chat, said, reply, text: reply.continues?.text ?? '' });
    const abort = new AbortController();
    this.abort = abort;
    const ready = await prepare(abort.signal);
    if ('kind' in ready) {
      this.set(null);
      return ready;
    }
    const { route, settings, prompt } = ready;

    const sending = ready.said && appendUserMessage(this.store, chat, ready.said);
    const replying = generate({
      credentials: this.credentials,
      connection: route.connection.value,
      model: route.model,
      settings,
      messages: prompt.messages,
      signal: abort.signal,
      onText: (phase, chunk) => phase === 'text' && this.set({ ...this.turn!, text: this.turn!.text + chunk }),
    });
    const sent = await sending;
    if (sent && !sent.ok) {
      abort.abort();
      await replying;
      this.set(null);
      return { kind: 'unsent', failure: sent };
    }
    const answer = await replying;

    const receipt: Receipt = { ...receiptOf(route, answer), ...(reply.continues && { continues: reply.continues.receipt }) };
    const written: Written = { id: reply.id, message: reply.message, replaces: reply.replaces, at: Date.now(), text: this.turn!.text, receipt, seed: reply.continues?.seed };
    // Kept before the save, whose store change is what shows the reply's 정보.
    this.sentBy.set(reply.id, { request: answer.request, prompt });
    const saved = await appendReply(this.store, chat, written);
    this.set(null);
    if (!saved.ok) {
      this.unsaved = { chat, reply: written };
      return { kind: 'unsaved', failure: saved };
    }
    this.settle(chat, receipt);
    return null;
  }
}

// What a call leaves in a saved chat: a reply's receipt, or a translation's (runtime/translate).
export function receiptOf(route: Route, answer: Reply): Receipt {
  return {
    connection: route.connection.id,
    source: route.connection.value.label,
    model: route.model.id,
    modelName: route.model.name,
    state: answer.state,
    cut: answer.cut,
    error: answer.error && receiptError(answer.error),
    finishReason: answer.finishReason,
    usage: answer.usage,
    cost: answer.cost,
    replyId: answer.replyId,
    firstTextMs: answer.firstTextMs,
    totalMs: answer.totalMs,
  };
}

// Field by field, never the error itself: whatever a network error gains must not reach saved chats.
function receiptError(error: NonNullable<Reply['error']>): ReceiptError {
  switch (error.kind) {
    case 'refused':
    case 'relay':
    case 'app':
      return { kind: error.kind, code: error.code };
    case 'provider':
      return 'status' in error ? { kind: 'provider', status: error.status, detail: error.detail } : { kind: 'provider', detail: error.detail };
    case 'bad-event':
    case 'network':
      return { kind: error.kind, detail: error.detail };
    case 'offline':
    case 'no-token':
      return { kind: error.kind };
  }
}
