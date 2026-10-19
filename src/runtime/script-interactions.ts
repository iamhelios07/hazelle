import { ChangeSignal } from '../change-signal';
import type { Role } from '../connectors/assignment';
import { Runaway } from '../engine/cbs/evaluate';
import type { Outcome, Question } from '../engine/script-api';
import { live, type PackOwner } from '../model/library';
import { toolId } from '../model/tool';
import type { ApiFailure, ApiResult } from './api';
import { EvaluationStuck } from './evaluation';
import { LuaStuck } from './lua/client';
import { setCardWrites } from './characters';
import { setModels, setNetwork, setTakesMemory } from './pack';
import { ToolLate, ToolStopped, ToolStuck } from './script-binding';
import type { ObjectStore } from './store';
import { toolsOf, ToolRate, TOOL_NOTICES_PER_MINUTE } from './tools/store';

// said: the script's own words (alertNormal, alertError, showAlert, a tool's say). The others are the app's about it.
// no-model: a script called a model of a role the chat has none for. flood: it called models faster than the server
// lets a chat's scripts (server/streams). late: a tool missed the prompt deadline and the turn went without its slot.
// stuck: disabled once a tool stalled too often, until reload. memory-held: a tool the user let take the memory slot
// cannot, since another tool before it in the chat holds it.
// unsaved: what a run did to the chat could not be saved. runaway: the script's commands were stopped for making too
// much text. input-stop: a script stopped a send before onStart (design §6.8: Risu ignores it there and replies), told
// once per chat, so the missing reply is not read as a dead bot.
type Note =
  | { kind: 'said'; tone: 'normal' | 'error'; text: string }
  | { kind: 'failed'; message: string }
  | { kind: 'missing'; names: string[] }
  | { kind: 'stuck'; disabled?: true }
  | { kind: 'no-model'; role: Role }
  | { kind: 'late' }
  | { kind: 'memory-held'; by: string }
  | { kind: 'stale-reply' }
  | { kind: 'flood' }
  | { kind: 'unsaved'; failure: ApiFailure }
  | { kind: 'runaway' }
  | { kind: 'input-stop' };
export type ScriptNote = { id: number; chat: string; from: PackOwner | null } & Note;
// Consent is saved on the spender, not the chat's character: 'yes' allows it and 'no' refuses it.
// A dismissal leaves it to be asked again. memory: a tool's claim on the memory slot, saved on its module.
// card: a script would rewrite the chat's character's card, saved on that character whichever script asked. network: a
// tool would reach the outside, saved on its module; hosts: the literal hosts its code names, none for a Hazelle tool.
export type ScriptQuestion = { id: number; chat: string; from: PackOwner; question: Question | { kind: 'model' } | { kind: 'memory' } | { kind: 'card' } | { kind: 'network'; hosts: string[] } };
export type ScriptsState = { notes: ScriptNote[]; questions: ScriptQuestion[] };

export class ScriptInteractions {
  private state: ScriptsState = { notes: [], questions: [] };
  private readonly changes = new ChangeSignal();
  private readonly answers = new Map<number, (answer: string | null) => void>();
  // What each chat was already told of its bot's errors, so a script failing on every message says so once.
  private readonly told = new Map<string, Set<string>>();
  private ids = 0;
  private readonly consents = new Map<string, Promise<boolean>>();
  private readonly notices = new ToolRate(TOOL_NOTICES_PER_MINUTE);

  constructor(private readonly store: ObjectStore, private readonly closing: AbortSignal) {}

  readonly subscribe = this.changes.subscribe;

  readonly snapshot = () => this.state;

  seen(note: number) {
    this.set({ ...this.state, notes: this.state.notes.filter(({ id }) => id !== note) });
  }

  // null: dismissed, which answers nothing.
  answer(question: number, answer: string | null) {
    this.answers.get(question)?.(answer);
  }

  close() {
    for (const { id } of this.state.questions) this.answer(id, null);
  }

  report(chat: string, result: Pick<Outcome, 'errors' | 'missing'> | unknown, from: PackOwner | null = null) {
    if (result instanceof ToolStopped) return;
    if (result instanceof ToolLate) return this.tell(chat, 'late', { kind: 'late' }, from);
    if (result instanceof ToolStuck) return result.disabled ? this.tell(chat, 'disabled', { kind: 'stuck', disabled: true }, from) : this.note(chat, { kind: 'stuck' }, from);
    if (result instanceof LuaStuck || result instanceof EvaluationStuck) return this.note(chat, { kind: 'stuck' }, from);
    if (result instanceof Runaway) return this.tell(chat, 'runaway', { kind: 'runaway' }, from);
    if (result instanceof Error) return this.tell(chat, `failed:${result.message}`, { kind: 'failed', message: result.message }, from);
    const { errors, missing } = result as Pick<Outcome, 'errors' | 'missing'>;
    for (const error of errors) {
      if ('runaway' in error) this.tell(chat, 'runaway', { kind: 'runaway' }, error.from);
      else this.tell(chat, `failed:${error.message}`, { kind: 'failed', message: `${error.script}: ${error.message}` }, error.from);
    }
    if (missing.length > 0) this.tell(chat, `missing:${missing.join()}`, { kind: 'missing', names: missing }, from);
  }

  ask(chat: string, question: ScriptQuestion['question'], from: PackOwner, signal?: AbortSignal): Promise<string | null> {
    if (this.closing.aborted || signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      const id = ++this.ids;
      const abort = () => this.answer(id, null);
      signal?.addEventListener('abort', abort, { once: true });
      this.answers.set(id, (answer) => {
        signal?.removeEventListener('abort', abort);
        this.answers.delete(id);
        this.set({ ...this.state, questions: this.state.questions.filter((each) => each.id !== id) });
        resolve(answer);
      });
      this.set({ ...this.state, questions: [...this.state.questions, { id, chat, question, from }] });
    });
  }

  // Whether spender may call models, embeddings included (design §6.8, §6.10): asked once per spender and kept on it.
  // Under a deadline an unanswered one is no, without a card; the next run with time to wait asks.
  async allowed(chat: string, from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<boolean> {
    const { store } = this;
    const spender = live(store.get(from.kind, from.id))!;
    if (spender.value.botModels !== undefined) return spender.value.botModels;
    if (deadline) return false;
    return this.decide(`${from.kind}:${from.id}`, chat, { kind: 'model' }, from, (yes) => setModels(store, from, yes), signal);
  }

  // Whether a script may rewrite character's card: asked once per character and kept on it, as allowed is.
  async mayRewrite(chat: string, character: string, from: PackOwner, deadline: boolean, signal?: AbortSignal): Promise<boolean> {
    const { store } = this;
    const stored = live(store.get('character', character));
    if (!stored) return false;
    if (stored.value.cardWrites !== undefined) return stored.value.cardWrites;
    if (deadline) return false;
    return this.decide(`card:${character}`, chat, { kind: 'card' }, from, (yes) => setCardWrites(store, character, yes), signal);
  }

  // Whether module's tool may reach the outside (design §6.10): asked once per module and kept on it, as allowed is.
  async mayFetch(chat: string, module: string, deadline: boolean, signal?: AbortSignal): Promise<boolean> {
    const { store } = this;
    const stored = live(store.get('module', module));
    if (!stored) return false;
    if (stored.value.network !== undefined) return stored.value.network;
    if (deadline) return false;
    const hosts = store.get('tool', toolId(module))?.value.manifest.risu?.hosts ?? [];
    return this.decide(`network:${module}`, chat, { kind: 'network', hosts }, { kind: 'module', id: module }, (yes) => setNetwork(store, module, yes), signal);
  }

  // What the chat's tools claim and the user has not answered, memory and network, each asked once per module when the
  // tool starts in a chat (design §6.10), not first when it uses it.
  claims(chat: string) {
    const { store } = this;
    const stored = live(store.get('chat', chat));
    if (!stored || this.closing.aborted) return;
    for (const { module, tool } of toolsOf(store, stored.value)) {
      const key = `memory:${module}`;
      if (tool.manifest.uses.includes('memory') && store.get('module', module)?.value.takesMemory === undefined && !this.consents.has(key)) {
        void this.decide(key, chat, { kind: 'memory' }, { kind: 'module', id: module }, (yes) => setTakesMemory(store, module, yes));
      }
      if (tool.manifest.uses.includes('network')) void this.mayFetch(chat, module, false);
    }
  }

  // One question per key at a time, its 'yes' or 'no' saved by save; a dismissal saves nothing and is no.
  private decide(key: string, chat: string, question: ScriptQuestion['question'], from: PackOwner, save: (yes: boolean) => Promise<ApiResult<unknown>>, signal?: AbortSignal): Promise<boolean> {
    let deciding = this.consents.get(key);
    if (!deciding) {
      deciding = this.ask(chat, question, from, signal).then(async (answer) => {
        if (answer === null) return false;
        const saved = await save(answer === 'yes');
        return saved.ok && answer === 'yes';
      }).finally(() => this.consents.delete(key));
      this.consents.set(key, deciding);
    }
    return deciding;
  }

  // A claim holds up no run, so it stays until the user answers it; a fetch that joined a network claim waits with it,
  // holding only its own tool's lane.
  dismiss(chat: string) {
    for (const { id, chat: asked, question } of this.state.questions) if (asked === chat && question.kind !== 'memory' && question.kind !== 'network') this.answer(id, null);
  }

  tell(chat: string, key: string, note: Note, from: PackOwner | null = null) {
    key = `${from?.kind}:${from?.id}:${key}`;
    const told = this.told.get(chat) ?? new Set();
    this.told.set(chat, told);
    if (told.has(key)) return;
    told.add(key);
    this.note(chat, note, from);
  }

  note(chat: string, note: Note, from: PackOwner | null = null) {
    if ((note.kind === 'said' || note.kind === 'failed') && from?.kind === 'module' && this.store.get('tool', toolId(from.id)) && !this.notices.take(`${chat}:${from.id}`)) return;
    this.set({ ...this.state, notes: [...this.state.notes, { id: ++this.ids, chat, from, ...note }] });
  }

  private set(state: ScriptsState) {
    this.state = state;
    this.changes.notify();
  }
}
