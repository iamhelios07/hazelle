import { providerFit } from './token-calibration';
import { answerInstructionOf, scopeOf, translationInput, tokenLimits, sentSettings } from './chat-context';
import { cacheSend, gatherTurn, type Target, type Blocked, type TurnContext } from './turn-context';
import { forecast, prior } from './cache';
import type { RanAway } from '../engine/pipeline';
import type { TooLong } from '../engine/prompt-budget';
import { fold, shown, type Chat } from '../model/chat';
import { live } from '../model/library';
import type { Stored } from '../model/kinds';
import { chatIllustrate, chatTranslate, featuresOf } from './features';
import type { Session } from './session';
import type { ApiFailure } from './api';
import type { Halted } from './scripts';
import { appendUserMessage, type Written } from './chat-log';
import { keepRow } from './usage';
import type { Ask, TalkFailure } from './talk';
import { EvaluationFailed, EvaluationStopped, evaluationFailure } from './evaluation';
import { endCall } from './streams';
import { resumeTranslation, translate, type TranslateFailure, type TranslateInput, type TranslationTarget } from './translate';
import { findRecords } from './retrieval';
import { preread, type PrereadFailure } from './preread';

// A turn also stops before sending on a new chat that was not saved, a pull that failed, a chat or message another
// device deleted, a user's message that was not translated, a tokenizer that did not load, a prompt over the model's
// budget, or a 토큰 절약 call that failed.
// kept: the user's message was saved all the same (a bot with Lua has it saved before its onStart runs), so the
// screen does not hand its text back.
export type TurnFailure = (
  | TalkFailure
  | Blocked
  | TooLong
  | RanAway
  | { kind: 'tokenizer' }
  | { kind: 'unstarted'; failure: ApiFailure }
  | { kind: 'unpulled'; failure: ApiFailure }
  | { kind: 'gone' }
  | { kind: 'untranslated'; failure: TranslateFailure }
  | { kind: 'preread'; failure: PrereadFailure }
) & { kept?: true };

// 설정 › 번역기 translates as a new 캐릭터 없이 chat would: the shared switches' prompt, that chat's 보조 모델 and the
// 전역 번역가의 노트. Nothing is saved, so no marker is written.
export const TRANSLATOR_CHAT: Chat = { title: null, character: null, models: {} };

// A text of no story, as a new chat would translate it (TRANSLATOR_CHAT, or a character's for its card's texts), but
// with no persona and no card: a card's text would go along as context of its own translation, every time.
// The call ends however it went, stopped too: the abort only stops reading, and no reload picks this call up.
export function translateText(session: Pick<Session, 'store' | 'credentials' | 'log' | 'tokens'>, chat: Chat, text: string, language: string, signal: AbortSignal, onText: (text: string) => void) {
  const input: TranslateInput = { chat, scope: { ...scopeOf(session, null, chat, []), persona: null, card: null }, take: new Set(), translations: [], request: { kind: 'input', text }, language, lane: null };
  const target: TranslationTarget = { id: crypto.randomUUID(), chat: null, result: crypto.randomUUID(), for: { kind: 'input', typed: text, language } };
  return translate(session, input, target, signal, onText).then(async (made) => {
    if (made.ok) await keepRow(session.store, made.translation.receipt!, made.translation.at, { chat: null, character: chat.character });
    return made;
  }).finally(() => endCall(session.store, target.id));
}

// Automatic 응답 번역 is for replies received here, never for what a chat already holds: opening a chat, a greeting, a
// version switched to and the switch turned on leave it to 번역 (user ruling, 2026-10-04). The reply is as saved; the
// bot's onOutput may have edited or removed its message since, so the message is read again. Its chat must stay
// loaded until this returns (session).
async function translateReceived(session: Pick<Session, 'store' | 'read' | 'translator'>, chat: string, reply: Written) {
  const view = await displayed(session, chat);
  if (!view || !chatTranslate(session.store, view.chat).replies) return;
  const index = view.messages.findIndex((message) => message.id === (reply.message ?? reply.id));
  if (index === -1) return;
  const version = shown(view.messages[index]!);
  // Another version, already translated, may have been switched to while onOutput ran.
  if (version.translation || !view.display.texts[index]!.trim()) return;
  void session.translator.translate(chat, version, { ...translationInput(session, chat, view.chat, view.messages, { kind: 'message', index }), lane: { asker: 'auto-translation', chat } });
}

const displayed = (session: Pick<Session, 'read'>, chat: string) =>
  session.read.displayed(chat).catch((error: unknown) => {
    if (error instanceof EvaluationStopped || error instanceof EvaluationFailed) return null;
    throw error;
  });

// 자동 이어 쓰기 (design §6.7): a reply cut at its length, or whose stream closed without its end (a deploy rebuilds the
// server object), is continued once (user, 2026-10-02). A continuation is never continued on its own, a manual one
// included; nor is a stop (멈추기), nor an empty reply, on which 이어 쓰기 is not offered either.
export function autoContinue({ text, receipt }: Pick<Written, 'text' | 'receipt'>): boolean {
  return receipt.state === 'cut' && (receipt.cut === 'length' || receipt.cut === 'no-terminal') && !receipt.continues && text !== '';
}

const idle = (talk: Session['talk'], chat: string) =>
  new Promise<void>((done) => {
    if (!talk.snapshot(chat)) return done();
    const stop = talk.subscribe(() => {
      if (talk.snapshot(chat)) return;
      stop();
      done();
    });
  });

// A reply this page has just saved (session's saved hook): continued when autoContinue says so and it is still the
// chat's last message as saved, else translated. Never both: a continuation that ran leaves the translation to the hook
// its own save calls, on the finished version. takeTurn answers null as well when a turn its chat began meanwhile turned it
// away, and the cut reply then stays untranslated. Its chat must stay loaded until this returns (session).
export async function receiveReply(session: Session, chat: string, reply: Written) {
  if (reply.receipt.state === 'failed') return;
  if (autoContinue(reply)) {
    // The reply's own turn still holds its chat in Talk when its save calls the hook.
    await idle(session.talk, chat);
    const last = (await displayed(session, chat))?.messages.at(-1);
    // An onOutput edit is a version of its own, which is not continued, as 이어 쓰기 is not offered on it.
    if (last?.id === (reply.message ?? reply.id) && shown(last).id === reply.id) {
      const failure = await takeTurn(session, chat, { kind: 'continue', message: last.id, version: reply.id });
      if (!failure) return;
    }
  }
  await translateReceived(session, chat, reply);
  const received = shownReceived(session, chat, reply);
  if (!received) return;
  if (chatIllustrate(session.store, received.chat).auto) session.illustrator.draw(chat, received.message, received.version, { auto: true });
  if (featuresOf(session.store, received.chat).mascot) session.commentator.comment(chat, received.message, received.version);
}

// What 삽화 on auto draws for and the mascot speaks on, as 응답 번역 translates it: the version of a reply received here
// shown once the bot's onOutput ran, after any continuation, never the cut one it continued. null for a chat gone or a
// version with no text.
function shownReceived({ store }: Pick<Session, 'store'>, chat: string, reply: Written): { chat: Chat; message: string; version: string } | null {
  const stored = live(store.get('chat', chat));
  if (!stored) return null;
  const message = fold(store.children('entry', chat)).find(({ id }) => id === (reply.message ?? reply.id));
  const version = message && shown(message);
  return version?.text.trim() ? { chat: stored.value, message: message!.id, version: version.id } : null;
}

// A new chat's save, which the turn is shown in while it runs, and the greeting it saved selected, which the turn
// follows. The turn never saves the chat itself: a press on the greeting may have started the same save, and a second
// create would be refused.
export type Starting = { greeting: string | null; saved: Promise<ApiFailure | null> };

// unshortened: this turn skips 토큰 절약, which the user asks for after it failed.
export function takeTurn(session: Session, chat: string, target: Target, start: Starting | null = null, unshortened = false): Promise<TurnFailure | null> {
  const ids = { said: crypto.randomUUID(), reply: crypto.randomUUID() };
  const again = (answer: boolean) => gatheredTurn(session, chat, answer ? { kind: 'answer' } : target, ids);
  if (start) {
    const { greeting } = start;
    const said = target.kind === 'send' ? { id: ids.said, text: target.text, follows: greeting } : null;
    return unhalted(session.talk.run({ chat, said, reply: { id: ids.reply, message: null, replaces: null, follows: said ? said.id : greeting, continues: null } }, async (signal, prereading) => {
      const unstarted = await start.saved;
      if (unstarted) return { kind: 'unstarted', failure: unstarted };
      // The chat was just saved and a new chat's target names no message, so it is there.
      const turn = (await gatheredTurn(session, chat, target, ids))!;
      return 'kind' in turn ? turn : prepare(session, chat, turn, signal, again, unshortened ? null : prereading);
    }));
  }
  const lease = session.store.retainChat(chat);
  const send = (): Promise<TurnFailure | null> => {
    const showing = gatherTurn(session, chat, target, ids);
    if (showing === null || 'kind' in showing) return Promise.resolve(showing);
    return unhalted(session.talk.run({ chat, said: showing.said, reply: showing.reply }, async (signal, prereading) => {
      // Another device may have written to this chat while this page stood open without focus or a timer's pull, so the
      // prompt is gathered again after a pull. A turn it cannot pull does not send on what may be stale.
      const unpulled = await session.store.pull();
      if (unpulled) return { kind: 'unpulled', failure: unpulled };
      const turn = await gatheredTurn(session, chat, target, ids);
      if (turn === null) return { kind: 'gone' };
      return 'kind' in turn ? turn : prepare(session, chat, turn, signal, again, unshortened ? null : prereading);
    }));
  };
  const sending = lease.ready.then((failure): Promise<TurnFailure | null> => failure ? Promise.resolve({ kind: 'unpulled', failure }) : send());
  return sending.finally(lease.release);
}

// A turn the bot's Lua ended before any request (stopChat) is not a failure: the user's message stays, and nothing
// is said of it.
const unhalted = (turn: Promise<TurnFailure | Halted | null>): Promise<TurnFailure | null> => turn.then((failure) => (failure?.kind === 'halted' ? null : failure));

// Stopped with the turn, or a worker that failed. Either way the screen puts the typed text back and reports it, as for
// any message not sent.
type Unevaluated = { kind: 'unsent'; failure: ApiFailure };
const evaluating = <T>(work: Promise<T>): Promise<T | Unevaluated> => work.catch((error: unknown) => ({ kind: 'unsent' as const, failure: evaluationFailure(error) }));

// The turn as the chat stands once what was last written to it is evaluated: a write returns before its chat's
// projection is made again (ChatProjections.refreshHeld).
async function gatheredTurn(session: Pick<Session, 'store' | 'read'>, chat: string, target: Target, ids: Parameters<typeof gatherTurn>[3]): Promise<TurnContext | Blocked | Unevaluated | null> {
  const evaluated = await evaluating(session.store.projections.evaluate(chat));
  return evaluated && 'kind' in evaluated ? evaluated : gatherTurn(session, chat, target, ids);
}

// prereading null: this turn skips 토큰 절약.
async function prepare(session: Session, chat: string, gathered: TurnContext, signal: AbortSignal, again: (answer: boolean) => Promise<TurnContext | Blocked | Unevaluated | null>, prereading: (() => void) | null): Promise<Ask | Halted | TurnFailure> {
  const translated = gathered.said && chatTranslate(session.store, gathered.chat).input ? await sendTranslated(session, chat, gathered, signal) : gathered;
  if ('kind' in translated) return translated;
  const started = await session.scripts.starting(chat, translated, again, signal);
  if ('kind' in started) return started;
  const prompted = await session.scripts.prompting(chat, started.turn, () => again(translated.said !== null && started.turn.said === null), signal);
  if ('kind' in prompted) return prompted;
  if (signal.aborted) return { kind: 'halted' };
  const { turn, tools } = prompted;
  const { route, settings, scope, budget, said, reply } = turn;
  const memory = turn.memory?.kind === 'built-in' ? { ...turn.memory, found: await findRecords(session, chat, scope.messages, signal) } : turn.memory;
  const kept = translated.said !== null && said === null ? { kept: true as const } : {};
  const snapshot = await session.tokens.snapshot(route, settings, tokenLimits(route.model, sentSettings(session.store, route)), 'conversation', chat, signal);
  if (!snapshot.ok) return { kind: 'unsent', failure: snapshot, ...kept };
  const calibration = snapshot.data;
  const fit = providerFit(route, settings, calibration.fit.allowance);
  const prompt = await evaluating(session.store.evaluation.prompt({ asker: 'send', chat }, { tools, scope, seed: reply.id, budget, fit, continuing: reply.continues !== null, answerInstruction: answerInstructionOf(session.store), memory }, signal));
  if ('kind' in prompt) return { ...prompt, ...kept };
  const requested = await session.scripts.requesting(chat, turn, prompt);
  const rewritten = await evaluating(session.store.evaluation.rewrite({ asker: 'send', chat }, scope, { prompt, messages: requested.messages, fit }, signal));
  if ('kind' in rewritten) return { ...rewritten, ...kept };
  // After the scripts, so a bot's Lua sees the prompt as built and never the brief; before the forecast and the refit,
  // which compare and fit what is sent.
  const shortened = prereading && featuresOf(session.store, turn.chat).preread ? await preread(session, chat, turn.chat, scope, rewritten, route, reply.id, signal, prereading) : { prompt: rewritten, preread: null };
  if ('kind' in shortened) return { kind: 'preread', failure: shortened, ...kept };
  const sent = shortened.prompt;
  const before = [...(reply.before ?? []), ...requested.writes];
  const send = cacheSend({ turn, prompt: sent, calibration }, session.credentials.pool.peek(route.connection.value)?.id ?? null);
  const against = send && forecast(prior(session.store, chat, session.read.chat(chat).snapshot()!.messages, Date.now()), send)?.against;
  const refit: Ask['refit'] = async (refusal, measurement) => {
    const decision = calibration.refused(refusal, measurement);
    if (!decision) return null;
    const fitted = await evaluating(session.store.evaluation.rewrite({ asker: 'send', chat }, scope, { prompt: sent, messages: sent.messages, fit: { ...fit, allowance: decision.allowance } }, signal));
    return 'kind' in fitted ? null : { prompt: fitted, fit: decision, retries: [...calibration.retries] };
  };
  return { route, settings, prompt: sent, calibration: { fit: calibration.fit, retries: [] }, refit, said, ...(before.length > 0 && { before }), ...(against && { forecast: against }), ...(shortened.preread && { preread: shortened.preread }) };
}

// A message being translated for sending when this page came, which Streams hands over. It is saved translated, or
// as typed when the translation failed, so what the user wrote is never lost; its reply waits for 응답 받기, since
// another device may be reading the same call.
export async function resumeSend(session: Pick<Session, 'store' | 'credentials' | 'log' | 'streams'>, stream: Stored<'stream'>, signal: AbortSignal) {
  const purpose = stream.value.for;
  if (purpose.kind !== 'input') return;
  const lease = session.store.retainChat(stream.parent!);
  try {
    if (await lease.ready) return;
    session.streams.reading.add(stream.id);
    const made = await resumeTranslation(session, stream, signal, () => {}).finally(() => session.streams.reading.delete(stream.id));
    if (!made.ok && made.failure.kind === 'stopped') return;
    const id = stream.value.result;
    const follows = purpose.follows !== undefined && { follows: purpose.follows };
    const said = made.ok ? { id, text: made.translation.text, ...follows, translation: { ...made.translation, text: purpose.typed, sentIn: purpose.language } } : { id, text: purpose.typed, ...follows };
    const saved = await appendUserMessage(session.store, stream.parent!, said);
    if (!saved.ok && saved.error === 'stopped') return;
    if (saved.ok || session.store.children('entry', stream.parent!).some((entry) => entry.id === id)) endCall(session.store, stream.id);
  } finally { lease.release(); }
}

// The user's message goes out translated, which the prompt sends and the chat saves as its text, with
// what the user typed as its translation. The chat's messages before it are the translation's context.
// Its call ends as soon as it is translated: a marker left until the message is saved would let a pick-up save the
// message a second time, beside Talk's own save.
async function sendTranslated(session: Session, chat: string, turn: TurnContext, signal: AbortSignal): Promise<TurnContext | Extract<TurnFailure, { kind: 'untranslated' }>> {
  const typed = turn.said!;
  const messages = session.read.chat(chat).snapshot()!.messages;
  const input = translationInput(session, chat, turn.chat, messages, { kind: 'input', text: typed.text });
  const { language } = input;
  const target: TranslationTarget = { id: crypto.randomUUID(), chat, result: typed.id, for: { kind: 'input', typed: typed.text, language, ...(typed.follows !== undefined && { follows: typed.follows }) } };
  session.streams.reading.add(target.id);
  const made = await translate(session, input, target, signal, () => {}).finally(() =>
    session.streams.reading.delete(target.id),
  );
  endCall(session.store, target.id);
  if (!made.ok) return { kind: 'untranslated', failure: made.failure };
  const sent = made.translation.text;
  const last = turn.scope.messages.at(-1)!;
  return {
    ...turn,
    scope: { ...turn.scope, messages: turn.scope.messages.with(-1, { ...last, text: sent }) },
    said: { id: typed.id, text: sent, ...(typed.follows !== undefined && { follows: typed.follows }), translation: { ...made.translation, text: typed.text, sentIn: language } },
  };
}
