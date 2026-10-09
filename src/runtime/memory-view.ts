import { memoryBudget, speakersOf, windowStart, type ChatRead, type RecordStatus, type Staleness, type Standing } from '../engine/memory';
import type { Assembled } from '../engine/pipeline';
import type { ChatScope } from '../engine/render';
import type { Chat } from '../model/chat';
import type { Memory } from '../model/memory';
import { asSent, promptBudget, scopeOf } from './chat-context';
import { chatMemory, memoryOwner, memorySetup, sourcesOf, type MemorySetup } from './memory-read';
import type { Session } from './session';
import { wouldSend } from './turn-context';

// asker: background memory's lane or the memory panel's (turn-context wouldSend).
export type ChatSent = { chat: Chat; scope: ChatScope; read: ChatRead; tokens: number[]; standing: Standing | null };

export async function chatSent(session: Pick<Session, 'store' | 'read'>, id: string, asker: 'memory' | 'view', memory: Memory | null): Promise<ChatSent | { kind: 'tokenizer' } | null> {
  if (!(await session.store.projections.evaluate(id))) return null;
  const stored = session.store.get('chat', id);
  const model = session.read.chat(id).snapshot();
  if (!stored || !model) return null;
  const messages = asSent(session.store, stored.value, model.messages);
  const scope = scopeOf(session, id, stored.value, messages);
  const shown = sourcesOf(messages);
  const budget = memoryBudget(memorySetup(session.store, stored.value).budget, promptBudget(session.store, stored.value));
  const texts = await session.store.evaluation.read({ asker, chat: id }, scope, memory && { memory, shown, budget });
  if ('kind' in texts) return texts;
  return { chat: stored.value, scope, read: { shown, roles: messages.map(({ role }) => role), speakers: speakersOf(scope), texts: texts.texts }, tokens: texts.tokens, standing: texts.standing };
}

// slot: whether the chat's prompt holds 장기 기억 where a request reaches it, false while the chat cannot send. stale: why
// each stale record is, a record the user edited or pinned included, which stays sent. waiting: messages past the window
// not summarized yet. tokens: what the slot sends against its budget (shrunk to what the model can take), and the
// state's share against its limit. holder: the tool that holds the chat's memory slot, whose records here then wait
// as they are (design §6.10).
export type MemoryView = {
  memory: Memory;
  setup: MemorySetup;
  holder: { module: string; name: string; page: boolean } | null;
  slot: boolean;
  records: ReadonlyMap<string, RecordStatus>;
  stale: ReadonlyMap<string, Staleness>;
  covered: number;
  waiting: number;
  tokens: { used: number; budget: number; state: number; stateLimit: number };
  crowded: boolean;
};

export async function memoryView(session: Pick<Session, 'store' | 'read' | 'scripts'>, chat: string): Promise<MemoryView | null> {
  const memory = chatMemory(session.store, chat);
  const sent = await chatSent(session, chat, 'view', memory);
  if (!sent || 'kind' in sent) return null;
  const setup = memorySetup(session.store, sent.chat);
  const held = sent.standing!;
  const owner = memoryOwner(session.store, sent.chat);
  return {
    memory,
    setup,
    holder: owner?.kind === 'tool' ? { module: owner.unit.module, name: owner.unit.tool.manifest.displayName, page: owner.unit.tool.manifest.page !== null } : null,
    slot: (await wouldSend(session, chat, { kind: 'answer' }, undefined, 'view'))?.prompt.memory?.slot ?? false,
    records: held.status,
    stale: held.stale,
    covered: held.covered,
    waiting: Math.max(windowStart(sent.tokens, setup.window) - held.covered, 0),
    tokens: held.tokens,
    crowded: held.crowded,
  };
}

export const leaving = (prompt: Assembled): number => (prompt.memory?.missing ?? 0) + prompt.dropped;
