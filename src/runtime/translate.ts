import { ChangeSignal } from '../change-signal';
import type { RanAway } from '../engine/pipeline';
import type { ChatScope } from '../engine/render';
import type { TranslationRequest } from '../engine/translate';
import type { Chat, Receipt, Translation, Version } from '../model/chat';
import type { Stored } from '../model/kinds';
import type { TranslatePrompt } from '../model/prompt';
import type { Stream } from '../model/stream';
import type { Phase } from '../connectors/types';
import type { ApiFailure, ApiResult } from './api';
import { taskModel, type Route, type RouteFailure } from './assignment';
import { setTextTranslation, translateSwitches, translatorNotes } from './characters';
import { appendTranslation, savedElsewhere } from './chat-log';
import type { Costs } from './cost';
import type { Credentials } from './credential';
import { generate, resume, type Reply } from './generate';
import { callOf, endCall, newCall, type CallTarget } from './streams';
import { modelProfile } from './profiles';
import { translationPrompt } from './prompts';
import type { ObjectStore } from './store';
import { receiptOf } from './talk';
import { evaluationFailure, type Lane } from './evaluation';

// take: the display scripts that draw the status window (상태창 지정), whose boxes the source leaves out.
// language: what the text is translated into. lane: auto-translation for 응답 번역, which a chat judged stuck refuses;
// null for a text of no chat (translateText).
export type TranslateInput = { chat: Chat; scope: ChatScope; take: ReadonlySet<number>; translations: (string | null)[]; request: TranslationRequest; language: string; lane: Lane<'translation' | 'auto-translation'> | null };

// failed: the call's receipt says why, and a cut one that wrote nothing is failed too.
export type TranslateFailure =
  | RouteFailure
  | { kind: 'prompt-missing'; own: boolean }
  | { kind: 'profile-missing'; own: boolean }
  | { kind: 'tokenizer' }
  | { kind: 'failed'; receipt: Receipt }
  | { kind: 'stopped' }
  | { kind: 'unsaved'; failure: ApiFailure }
  | RanAway;

type Deps = { store: ObjectStore; credentials: Credentials };

// A translation cut at its length keeps what it wrote, and its receipt says it was cut.
export async function translate(
  { store, credentials }: Deps,
  { chat, scope, take, translations, request, language, lane }: TranslateInput,
  target: CallTarget,
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<Translated> {
  const translator = translatorOf(store, chat);
  if (!translator.ok) return translator;
  const { prompt, route } = translator;
  const profile = modelProfile(store, route.model);
  if (profile.kind === 'missing') return { ok: false, failure: { kind: 'profile-missing', own: profile.own } };
  const assembled = await store.evaluation.translation(lane, { scope, take, prompt, translations, notes: translatorNotes(store, chat.character), request, language, seed: crypto.randomUUID() }, signal).catch((error: unknown) => {
    const failure = evaluationFailure(error);
    return failure.error === 'stopped' ? { kind: 'stopped' as const } : { kind: 'unsaved' as const, failure };
  });
  if ('kind' in assembled) return { ok: false, failure: assembled };
  const text = gather(onText);
  const answer = await generate({
    credentials,
    connection: route.connection.value,
    model: route.model,
    settings: profile.profile.value.settings,
    messages: assembled.messages,
    call: await newCall(store, route, target),
    signal,
    onText: text.add,
  });
  return translated(callOf(route), answer, text.value(), language);
}

// A translation the server was already making when this page came (tech-spec §6, Detached replies). Only a saved
// chat's translations are picked up, so no language is needed: a greeting's translation is never one of them.
export async function resumeTranslation(store: ObjectStore, stream: Stored<'stream'>, signal: AbortSignal, onText: (text: string) => void): Promise<Translated> {
  const text = gather(onText);
  const answer = await resume(store, stream, signal, text.add);
  return translated(stream.value.call, answer, text.value(), null);
}

type Translated = { ok: true; translation: Translation; language: string | null } | { ok: false; failure: TranslateFailure };

function gather(onText: (text: string) => void) {
  let text = '';
  return {
    add: (phase: Phase, chunk: string) => {
      if (phase !== 'text') return;
      text += chunk;
      onText(text);
    },
    value: () => text,
  };
}

function translated(call: Stream['call'], answer: Reply, text: string, language: string | null): Translated {
  if (answer.cut === 'stopped') return { ok: false, failure: { kind: 'stopped' } };
  const receipt = receiptOf(call, answer);
  if (answer.state === 'failed' || !text.trim()) return { ok: false, failure: { kind: 'failed', receipt } };
  return { ok: true, translation: { text: text.trim(), receipt, at: Date.now() }, language };
}

export function translatorOf(store: ObjectStore, chat: Chat): { ok: true; prompt: TranslatePrompt; route: Route } | { ok: false; failure: RouteFailure | { kind: 'prompt-missing'; own: boolean } } {
  const prompt = translationPrompt(store, translateSwitches(store, chat.character).prompt);
  if (prompt.kind === 'missing') return { ok: false, failure: { kind: 'prompt-missing', own: prompt.own } };
  const route = taskModel(store, chat, prompt.prompt.value.model);
  return 'kind' in route ? { ok: false, failure: route } : { ok: true, prompt: prompt.prompt.value, route };
}

// A prompt made before the 번역가의 노트 slot existed, the stored 기본 번역 among them, sends no note until the user adds
// the block.
export const sendsNotes = (prompt: TranslatePrompt) => prompt.blocks.some((block) => block.kind === 'slot' && block.slot === 'note');

export type TranslatorFailure = Exclude<TranslateFailure, { kind: 'stopped' }>;

// failed: why the last try at a version did not translate it, kept for the session.
export type Translating = { live: ReadonlyMap<string, string>; failed: ReadonlyMap<string, TranslatorFailure> };

// Unlike replies, several run at once, one per version, and each goes on when its chat is left.
export class Translator {
  private closed = false;
  private state: Translating = { live: new Map(), failed: new Map() };
  private readonly aborts = new Map<string, AbortController>();
  private readonly changes = new ChangeSignal();

  constructor(
    private readonly store: ObjectStore,
    private readonly credentials: Credentials,
    private readonly costs: Costs,
    // The calls this page reads (runtime/streams).
    private readonly reading: Set<string>,
  ) {}

  readonly subscribe = this.changes.subscribe;

  readonly snapshot = () => this.state;

  private change(version: string, change: { live?: string | null; failed?: TranslatorFailure | null }) {
    const next = { live: new Map(this.state.live), failed: new Map(this.state.failed) };
    if (change.live === null) next.live.delete(version);
    else if (change.live !== undefined) next.live.set(version, change.live);
    if (change.failed === null) next.failed.delete(version);
    else if (change.failed) next.failed.set(version, change.failed);
    this.state = next;
    this.changes.notify();
  }

  // chat: its id, saved or not yet; a chat not saved when the translation ends shows only its character's greetings,
  // so the translation is that greeting's, kept on the character.
  // closed: a reply stopped by a lock is still saved, and its follow-up must not start a call.
  translate(chat: string, { id: version, text: original }: Version, input: TranslateInput) {
    if (this.closed || this.aborts.has(version)) return;
    const target: CallTarget = { id: crypto.randomUUID(), chat: this.store.get('chat', chat) ? chat : null, result: crypto.randomUUID(), for: { kind: 'translation', version } };
    this.run(chat, version, target, (signal, onText) => translate({ store: this.store, credentials: this.credentials }, input, target, signal, onText), (made) =>
      this.store.get('chat', chat)
        ? appendTranslation(this.store, chat, version, made.translation, target.result)
        : setTextTranslation(this.store, input.chat.character!, original, made.language!, made.translation),
    );
  }

  resume(stream: Stored<'stream'>, version: string) {
    const chat = stream.parent!;
    if (this.closed || this.aborts.has(version)) return;
    this.run(chat, version, { id: stream.id, result: stream.value.result }, (signal, onText) => resumeTranslation(this.store, stream, signal, onText), (made) =>
      appendTranslation(this.store, chat, version, made.translation, stream.value.result),
    );
  }

  // A failed call ends with its marker, since nothing would make it go otherwise; one stopped by close() keeps it
  // for the next load.
  private run(chat: string, version: string, { id, result }: { id: string; result: string }, make: (signal: AbortSignal, onText: (text: string) => void) => Promise<Translated>, save: (made: Extract<Translated, { ok: true }>) => Promise<ApiResult<unknown>>) {
    const lease = this.store.retainChat(chat);
    const abort = new AbortController();
    this.aborts.set(version, abort);
    this.reading.add(id);
    this.change(version, { live: '', failed: null });
    void lease.ready.then(async (failure) => {
      if (failure) {
        this.change(version, { live: null, failed: { kind: 'unsaved', failure } });
        return null;
      }
      return make(abort.signal, (text) => this.change(version, { live: text }));
    })
      .then(
        async (made) => {
          if (!made) return;
          if (!made.ok) {
            if (made.failure.kind !== 'stopped') endCall(this.store, id);
            return this.change(version, { live: null, failed: made.failure.kind === 'stopped' ? null : made.failure });
          }
          const saved = await save(made);
          if (!saved.ok && !savedElsewhere(this.store, chat, result, saved)) return this.change(version, { live: null, failed: { kind: 'unsaved', failure: saved } });
          // The live text goes once the store holds the translation, so the original never shows in between.
          this.change(version, { live: null, failed: null });
          endCall(this.store, id);
          // The device that saved it counts its cost.
          if (saved.ok && this.store.get('chat', chat)) this.costs.settle(chat, made.translation.receipt!);
        },
        (error: unknown) => {
          this.change(version, { live: null });
          throw error;
        },
      )
      .finally(() => {
        this.aborts.delete(version);
        this.reading.delete(id);
        lease.release();
      });
  }

  close() {
    this.closed = true;
    for (const abort of this.aborts.values()) abort.abort();
  }
}
