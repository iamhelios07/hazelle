import { ChangeSignal } from '../change-signal';
import type { Role } from '../connectors/assignment';
import { Runaway } from '../engine/cbs/evaluate';
import type { Outcome, Question } from '../engine/script-api';
import { live, type PackOwner } from '../model/library';
import { toolId } from '../model/tool';
import type { ApiFailure } from './api';
import { EvaluationStuck } from './evaluation';
import { LuaStuck } from './lua/client';
import { setModels, setTakesMemory } from './pack';
import { ToolLate, ToolStopped, ToolStuck } from './script-binding';
import type { ObjectStore } from './store';
import { toolsOf, ToolRate, TOOL_NOTICES_PER_MINUTE } from './tools/store';

// said: the script's own words (alertNormal, alertError, showAlert, a tool's say). The others are the app's about it.
// no-model: a script called a model of a role the chat has none for. flood: it called models faster than the server
// lets a chat's scripts (server/streams). late: a tool missed the prompt deadline and the turn went without its slot.
// stuck: disabled once a tool stalled too often, until reload. memory-held: a tool the user let take the memory slot
// cannot, since another tool before it in the chat holds it.
// unsaved: what a run did to the chat could not be saved. runaway: the script's commands were stopped for making too
// much text.
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
  | { kind: 'runaway' };
export type ScriptNote = { id: number; chat: string; from: PackOwner | null } & Note;
// Consent is saved on the spender, not the chat's character: 'yes' allows it and 'no' refuses it.
// A dismissal leaves it to be asked again. memory: a tool's claim on the memory slot, saved on its module.
export type ScriptQuestion = { id: number; chat: string; from: PackOwner; question: Question | { kind: 'model' } | { kind: 'memory' } };
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
    const spender = live(store.get(from.kind, from.id));
    if (!spender) return false;
    if (spender.value.botModels !== undefined) return spender.value.botModels;
    if (deadline) return false;
    const key = `${from.kind}:${from.id}`;
    let deciding = this.consents.get(key);
    if (!deciding) {
      deciding = this.ask(chat, { kind: 'model' }, from, signal).then(async (answer) => {
        if (answer === null) return false;
        const saved = await setModels(store, from, answer === 'yes');
        return saved.ok && answer === 'yes';
      }).finally(() => this.consents.delete(key));
      this.consents.set(key, deciding);
    }
    return deciding;
  }

  // The memory claims of the chat's tools that the user has not answered, each asked once per module (design §6.10).
  claims(chat: string) {
    const { store } = this;
    const stored = live(store.get('chat', chat));
    if (!stored || this.closing.aborted) return;
    for (const { module, tool } of toolsOf(store, stored.value)) {
      const key = `memory:${module}`;
      if (!tool.manifest.uses.includes('memory') || store.get('module', module)?.value.takesMemory !== undefined || this.consents.has(key)) continue;
      const deciding = this.ask(chat, { kind: 'memory' }, { kind: 'module', id: module }).then(async (answer) => {
        if (answer === null) return false;
        const saved = await setTakesMemory(store, module, answer === 'yes');
        return saved.ok && answer === 'yes';
      }).finally(() => this.consents.delete(key));
      this.consents.set(key, deciding);
    }
  }

  // A memory claim holds up no run, so it stays until the user answers it.
  dismiss(chat: string) {
    for (const { id, chat: asked, question } of this.state.questions) if (asked === chat && question.kind !== 'memory') this.answer(id, null);
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
