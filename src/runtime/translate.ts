import { assembleTranslation } from '../engine/pipeline';
import type { ChatScope } from '../engine/render';
import type { TranslationRequest } from '../engine/translate';
import type { Chat, Receipt, Translation } from '../model/chat';
import type { ApiFailure } from './api';
import { chatModel, type RouteFailure } from './assignment';
import { translateSwitches } from './characters';
import { appendTranslation } from './chat-log';
import type { Credentials } from './credential';
import { generate } from './generate';
import { modelProfile } from './profiles';
import { translationPrompt } from './prompts';
import type { ObjectStore } from './store';
import { receiptOf, type Talk } from './talk';
import { tokenizer } from './tokenizer';

// What one translation is made from: the chat, whose layers pick the 번역 model and whose character's 번역 the
// prompt and the language, its scope with each message's translation text or null, and what to translate.
export type TranslateInput = { chat: Chat; scope: ChatScope; translations: (string | null)[]; request: TranslationRequest };

// prompt-missing: the translation prompt chosen (own) or the default is gone. failed: the call's receipt says why, and
// a cut one that wrote nothing is failed too.
export type TranslateFailure =
  | RouteFailure
  | { kind: 'prompt-missing'; own: boolean }
  | { kind: 'profile-missing'; own: boolean }
  | { kind: 'tokenizer' }
  | { kind: 'failed'; receipt: Receipt }
  | { kind: 'stopped' };

type Deps = { store: ObjectStore; credentials: Credentials };

// One call to the chat's 번역 model, with that model's 설정 묶음, through the character's translation prompt. A reply
// goes into its replyLanguage and the user's message into its inputLanguage. A translation cut at its length keeps what it
// wrote, and its receipt says it was cut.
export async function translate(
  { store, credentials }: Deps,
  { chat, scope, translations, request }: TranslateInput,
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<{ ok: true; translation: Translation } | { ok: false; failure: TranslateFailure }> {
  const switches = translateSwitches(store, chat.character);
  const prompt = translationPrompt(store, switches.prompt);
  if (prompt.kind === 'missing') return { ok: false, failure: { kind: 'prompt-missing', own: prompt.own } };
  const route = chatModel(store, chat, 'translate');
  if ('kind' in route) return { ok: false, failure: route };
  const profile = modelProfile(store, route.model);
  if (profile.kind === 'missing') return { ok: false, failure: { kind: 'profile-missing', own: profile.own } };
  const countTokens = await tokenizer().catch(() => null);
  if (!countTokens) return { ok: false, failure: { kind: 'tokenizer' } };
  const language = request.kind === 'message' ? switches.replyLanguage : switches.inputLanguage;
  let text = '';
  const answer = await generate({
    credentials,
    connection: route.connection.value,
    model: route.model,
    settings: profile.profile.value.settings,
    messages: assembleTranslation({ scope, prompt: prompt.prompt.value, translations, request, language, seed: crypto.randomUUID(), countTokens }).messages,
    signal,
    onText: (phase, chunk) => {
      if (phase !== 'text') return;
      text += chunk;
      onText(text);
    },
  });
  if (answer.cut === 'stopped') return { ok: false, failure: { kind: 'stopped' } };
  const receipt = receiptOf(route, answer);
  if (answer.state === 'failed' || !text.trim()) return { ok: false, failure: { kind: 'failed', receipt } };
  return { ok: true, translation: { text: text.trim(), receipt, at: Date.now() } };
}

export type TranslatorFailure = Exclude<TranslateFailure, { kind: 'stopped' }> | { kind: 'unsaved'; failure: ApiFailure };

// live: the text so far of each translation being made, by the version's id. failed: why the last try at a version
// did not translate it, kept for the session so a chat does not try it again on its own. held: translations of a
// new chat's greetings, which startChat saves with them.
export type Translating = { live: ReadonlyMap<string, string>; failed: ReadonlyMap<string, TranslatorFailure>; held: ReadonlyMap<string, Translation> };

// The translations of the chats' messages. Unlike replies, several run at once, one per version, and each goes
// on when its chat is left.
export class Translator {
  private state: Translating = { live: new Map(), failed: new Map(), held: new Map() };
  private readonly aborts = new Map<string, AbortController>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly store: ObjectStore,
    private readonly credentials: Credentials,
    private readonly talk: Talk,
  ) {}

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = () => this.state;

  private change(version: string, change: { live?: string | null; failed?: TranslatorFailure | null; held?: Translation }) {
    const next = { live: new Map(this.state.live), failed: new Map(this.state.failed), held: new Map(this.state.held) };
    if (change.live === null) next.live.delete(version);
    else if (change.live !== undefined) next.live.set(version, change.live);
    if (change.failed === null) next.failed.delete(version);
    else if (change.failed) next.failed.set(version, change.failed);
    if (change.held) next.held.set(version, change.held);
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  // chat: its id, saved or not yet; a translation for a chat not saved when it ends is held.
  translate(chat: string, version: string, input: TranslateInput) {
    if (this.aborts.has(version)) return;
    const abort = new AbortController();
    this.aborts.set(version, abort);
    this.change(version, { live: '', failed: null });
    const deps = { store: this.store, credentials: this.credentials };
    void translate(deps, input, abort.signal, (text) => this.change(version, { live: text })).then(async (made) => {
      this.aborts.delete(version);
      if (!made.ok) return this.change(version, { live: null, failed: made.failure.kind === 'stopped' ? null : made.failure });
      if (!this.store.get('chat', chat)) return this.change(version, { live: null, held: made.translation });
      const saved = await appendTranslation(this.store, chat, version, made.translation);
      // The live text goes once the store holds the translation, so the original never shows in between.
      this.change(version, { live: null, failed: saved.ok ? null : { kind: 'unsaved', failure: saved } });
      if (saved.ok) this.talk.settle(chat, made.translation.receipt!);
    });
  }

  close() {
    for (const abort of this.aborts.values()) abort.abort();
  }
}
