import { ChangeSignal } from '../change-signal';
import type { ModelRef } from '../connectors/assignment';
import { resolveConnection } from '../connectors/registry';
import { ConnectorError, type Draws, type HttpRequest, type Picture, type PictureRequest } from '../connectors/types';
import { parseScenes, pictureRequest, type SceneInvalid } from '../engine/illustrate';
import type { RanAway } from '../engine/pipeline';
import { fold, type Chat, type Receipt } from '../model/chat';
import { without } from '../model/fields';
import { paragraphsOf, pictureCount, type Illustration, type Scene } from '../model/illustration';
import type { Stored } from '../model/kinds';
import { live } from '../model/library';
import type { Portrait } from '../model/likeness';
import type { IllustratePrompt } from '../model/prompt';
import type { ApiFailure } from './api';
import type { Route, RouteFailure } from './assignment';
import { chatIllustrate } from './features';
import { pinned, scopeOf } from './chat-context';
import { evaluatingTask } from './evaluation';
import type { ReplyError } from './generate';
import { taskWriter } from './profiles';
import { illustrationPrompt } from './prompts';
import { relayBytes, relayJson } from './relay';
import type { Session } from './session';
import type { ObjectStore } from './store';
import { pageAnswer } from './talk';
import { chatPlace, receiptRow } from './usage';

// 삽화 (design §6.6): per message per run, one scene call to the chat's 보조 model (or the 삽화 prompt's own) writes
// as many scenes as the reply's length earns (model/illustration pictureCount), and each is one image call, in turn. The only writer of `illustration` objects but a backup's restore and a chat's copies.

export type ImageRoute = Route & { draws: Draws };

// 삭제: the picture goes at once, and 되돌리기 writes it back under its id.
export const removeIllustration = (store: ObjectStore, id: string) => store.take('illustration', id);
export const restoreIllustration = (store: ObjectStore, removed: Stored<'illustration'>) => store.restore(removed);

// The starred models that draw: their output holds an image and their connection's type fills draws. The first is the
// image model of a chat whose switches name none.
export const drawingModels = (connections: readonly Stored<'connection'>[]): ImageRoute[] =>
  connections.flatMap((connection) => {
    const draws = resolveConnection(connection.value)?.type?.draws;
    return draws ? connection.value.starred.filter(({ output }) => output?.includes('image')).map((model) => ({ connection, model, draws })) : [];
  });

// no-image-model: no starred model draws. image-model-gone: the one the switches name no longer does.
// invalid: the scene writer answered, but not with a scene the format reads. undrawn: the image call failed or was refused.
// file-refused: the server refused the picture (too large, blocked, or past the account's picture cap).
// gone: the message or its version was deleted. empty: the version holds no text to draw from.
export type IllustrateFailure =
  | RouteFailure
  | { kind: 'prompt-missing'; own: boolean }
  | { kind: 'profile-missing'; own: boolean }
  | { kind: 'tokenizer' }
  | RanAway
  | { kind: 'failed'; receipt: Receipt }
  | { kind: 'invalid'; receipt: Receipt; reason: SceneInvalid }
  | { kind: 'no-image-model' }
  | { kind: 'image-model-gone' }
  | { kind: 'undrawn'; error: Exclude<ReplyError, { kind: 'stopped' }> }
  | { kind: 'not-a-picture' }
  // Not known to cost nothing (a used-up allowance, a plan without free pictures, or a connection that cannot say):
  // drawn only on the user's press, with spend.
  | { kind: 'costs' }
  | { kind: 'file-refused' }
  | { kind: 'gone' }
  | { kind: 'empty' }
  | { kind: 'unsaved'; failure: ApiFailure };

// A scene being drawn, or one whose picture failed, which a retry draws again without another scene call.
type Sketch = { scene: Scene; failure: IllustrateFailure | null };
// By message, one run each. writing: its scenes are being written. failure: the run failed before it had a scene, so
// it stands at the message's end. sketches: its scenes still to draw or failed; a saved picture takes a scene's place.
export type Drawing = { chat: string; version: string; writing: boolean; failure: IllustrateFailure | null; sketches: readonly Sketch[] };
export type Illustrating = ReadonlyMap<string, Drawing>;

export const runs = (drawing: Drawing) => drawing.writing || drawing.sketches.some(({ failure }) => failure === null);

type Stopped = { kind: 'stopped' };
type Deps = Pick<Session, 'tokens' | 'store' | 'credentials' | 'files' | 'likenesses'>;

export function sceneWriterOf(store: Deps['store'], chat: Chat): ReturnType<typeof taskWriter> | { kind: 'prompt-missing'; own: boolean } {
  const prompt = illustrationPrompt(store, chatIllustrate(store, chat).prompt);
  return prompt.kind === 'missing' ? { kind: 'prompt-missing', own: prompt.own } : taskWriter(store, chat, prompt.prompt.value.model);
}

function imageRoute(store: Deps['store'], ref: ModelRef | undefined): ImageRoute | { kind: 'no-image-model' } | { kind: 'image-model-gone' } {
  const routes = drawingModels(store.list('connection'));
  if (!ref) return routes[0] ?? { kind: 'no-image-model' };
  return routes.find(({ connection, model }) => connection.id === ref.connection && model.id === ref.model) ?? { kind: 'image-model-gone' };
}

// Several messages draw at once, each going on when its chat is left. A failure is kept for the session and never
// tried again on its own.
export class Illustrator {
  private closed = false;
  private state: Illustrating = new Map();
  private readonly aborts = new Map<string, AbortController>();
  private readonly changes = new ChangeSignal();

  constructor(private readonly deps: Deps) {}

  readonly subscribe = this.changes.subscribe;

  readonly snapshot = () => this.state;

  private change(message: string, drawing: Drawing | null) {
    const next = new Map(this.state);
    if (drawing && (drawing.writing || drawing.failure || drawing.sketches.length)) next.set(message, drawing);
    else next.delete(message);
    this.state = next;
    this.changes.notify();
  }

  private update(message: string, change: (drawing: Drawing) => Drawing) {
    const drawing = this.state.get(message);
    if (drawing) this.change(message, change(drawing));
  }

  private sketch(message: string, scene: Scene, failure: IllustrateFailure | null | 'drawn') {
    this.update(message, (drawing) => ({ ...drawing, sketches: failure === 'drawn' ? drawing.sketches.filter((each) => each.scene !== scene) : drawing.sketches.map((each) => (each.scene === scene ? { scene, failure } : each)) }));
  }

  // scene: one the user changed (어떻게 바꿀까요?) or a failed one's, drawn with no scene call; the version's other
  // failed scenes stay. auto: asked by a reply received here, whose scene a chat judged stuck refuses (evaluation's
  // passive gate). 다시 그리기 is another draw: earlier pictures of the version stay. spend: the user agreed to a picture
  // that may cost, as the switches' spend does for every draw.
  draw(chat: string, message: string, version: string, { scene = null, auto = false, spend = false }: { scene?: Scene | null; auto?: boolean; spend?: boolean } = {}) {
    if (this.closed || this.aborts.has(message)) return;
    const abort = new AbortController();
    this.aborts.set(message, abort);
    const previous = this.state.get(message);
    const kept = scene && previous?.version === version ? previous.sketches.filter((each) => each.scene !== scene) : [];
    this.change(message, { chat, version, writing: !scene, failure: null, sketches: [...kept, ...(scene ? [{ scene, failure: null }] : [])] });
    const lease = this.deps.store.retainChat(chat);
    void lease.ready
      .then(async (failure) => (failure ? { kind: 'unsaved' as const, failure } : this.run(chat, message, version, scene, auto, spend, abort.signal)))
      .then(
        (outcome) => {
          if (outcome?.kind === 'stopped') return this.change(message, null);
          // A failure before any picture is drawn is every waiting scene's, or the run's when it has none.
          this.update(message, (drawing) => {
            const waiting = drawing.sketches.some((each) => each.failure === null);
            const sketches = outcome && waiting ? drawing.sketches.map((each) => (each.failure === null ? { ...each, failure: outcome } : each)) : drawing.sketches;
            return { ...drawing, writing: false, failure: outcome && !waiting ? outcome : null, sketches };
          });
        },
        (error: unknown) => {
          this.change(message, null);
          throw error;
        },
      )
      .finally(() => {
        this.aborts.delete(message);
        lease.release();
      });
  }

  // 닫기 on a failure: the run's, or one scene's. A run under way has none to close.
  dismiss(message: string, scene: Scene | null = null) {
    const drawing = this.state.get(message);
    if (!drawing || runs(drawing)) return;
    if (scene) this.sketch(message, scene, 'drawn');
    else this.change(message, { ...drawing, failure: null });
  }

  close() {
    this.closed = true;
    for (const abort of this.aborts.values()) abort.abort();
  }

  // null once every scene is drawn or failed on its own; a failure returned came before any picture.
  private async run(chat: string, message: string, version: string, given: Scene | null, auto: boolean, spend: boolean, signal: AbortSignal): Promise<IllustrateFailure | Stopped | null> {
    const { store } = this.deps;
    const stored = live(store.get('chat', chat));
    const messages = fold(store.children('entry', chat));
    const index = messages.findIndex(({ id }) => id === message);
    const selected = messages[index]?.versions.findIndex(({ id }) => id === version) ?? -1;
    if (!stored || selected === -1) return { kind: 'gone' };
    const text = messages[index]!.versions[selected]!.text;
    const switches = chatIllustrate(store, stored.value);
    const route = imageRoute(store, switches.model);
    if ('kind' in route) return route;
    // A given scene draws with the tags and settings of the prompt chosen now, as a written one does.
    const prompt = illustrationPrompt(store, switches.prompt);
    if (prompt.kind === 'missing') return { kind: 'prompt-missing', own: prompt.own };
    // Before the scene call, which is told their names; a pack whose build fails is drawn without its portraits.
    const portraits = await this.deps.likenesses.portraits(stored.value, prompt.prompt.value, signal);
    let scenes = given ? [given] : [];
    let receipt: Receipt | null = null;
    if (!given) {
      const paragraphs = paragraphsOf(text);
      if (!paragraphs.length) return { kind: 'empty' };
      const history = [...messages.slice(0, index), { ...messages[index]!, selected }];
      const written = await this.scenes(chat, stored.value, history, paragraphs, pictureCount(switches.ladder, text), portraits, prompt.prompt.value, auto, signal);
      if ('kind' in written) return written;
      ({ scenes, receipt } = written);
      this.update(message, (drawing) => ({ ...drawing, writing: false, sketches: scenes.map((scene) => ({ scene, failure: null })) }));
    }
    const drawn = { chat, message, version, route, prompt: prompt.prompt.value, portraits, spend: spend || switches.spend, signal };
    // The scene call's row goes into the ledger once, with the first picture saved.
    let logged = false;
    // In turn: an image connection draws one picture at a time.
    for (const scene of scenes) {
      const outcome = await this.drawScene(drawn, scene, receipt, !logged);
      if (outcome?.kind === 'stopped') return outcome;
      this.sketch(message, scene, outcome ?? 'drawn');
      logged ||= !outcome;
    }
    return null;
  }

  // null once the illustration is saved. Each picture of the run keeps the receipt of the call that wrote its scene.
  private async drawScene(
    { chat, message, version, route, prompt, portraits, spend, signal }: { chat: string; message: string; version: string; route: ImageRoute; prompt: IllustratePrompt; portraits: Portrait[]; spend: boolean; signal: AbortSignal },
    scene: Scene,
    receipt: Receipt | null,
    log: boolean,
  ): Promise<IllustrateFailure | Stopped | null> {
    const { store, files } = this.deps;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    const request = pictureRequest(scene, prompt, route.model, seed, portraits);
    const drawn = await this.picture(route, request, spend, signal);
    if ('kind' in drawn) return drawn;
    const saved = await files.save([drawn.bytes], { signal });
    if (!saved.ok) return saved.error === 'stopped' ? { kind: 'stopped' } : { kind: 'unsaved', failure: saved };
    const file = saved.data[0];
    if (!file) return { kind: 'file-refused' };
    const illustration: Illustration = { message, version, scene, receipt, model: { connection: route.connection.id, model: route.model.id }, sent: without(request, 'model'), file, type: drawn.type, size: drawn.bytes.byteLength, at: Date.now() };
    const created = await store.batch([
      { type: 'create', kind: 'illustration', id: crypto.randomUUID(), parent: chat, value: illustration },
      ...(receipt && log ? [receiptRow(receipt, illustration.at, chatPlace(store, chat))] : []),
    ]);
    return created.ok ? null : { kind: 'unsaved', failure: created };
  }

  private async scenes(chat: string, value: Stored<'chat'>['value'], history: ReturnType<typeof fold>, paragraphs: string[], count: number, portraits: Portrait[], prompt: IllustratePrompt, auto: boolean, signal: AbortSignal): Promise<{ scenes: Scene[]; receipt: Receipt } | IllustrateFailure | Stopped> {
    const { store } = this.deps;
    const writer = taskWriter(store, value, prompt.model);
    if ('kind' in writer) return writer;
    const lane = { asker: auto ? ('auto-illustration' as const) : ('illustration' as const), chat };
    const scope = scopeOf({ store }, chat, value, history);
    const assembled = await evaluatingTask(store.evaluation.illustration(lane, { scope, take: pinned({ store }, value), prompt, index: history.length - 1, paragraphs, count, portraits: portraits.map(({ name, aliases, outfits }) => ({ name, aliases, outfits })), seed: crypto.randomUUID() }, signal));
    if ('kind' in assembled) return assembled;
    const answer = await pageAnswer(this.deps, writer, 'illustration', chat, assembled.messages, signal);
    if ('kind' in answer) return answer;
    const { receipt } = answer;
    const parsed = parseScenes(answer.text, paragraphs.length, count);
    return parsed.ok ? { scenes: parsed.scenes, receipt } : { kind: 'invalid', receipt, reason: parsed.reason };
  }

  // Straight through the relay: a picture is one answer, not a stream to pick up.
  private async picture({ connection, draws }: ImageRoute, picture: PictureRequest, spend: boolean, signal: AbortSignal): Promise<Picture | IllustrateFailure | Stopped> {
    const { credentials } = this.deps;
    let request: HttpRequest;
    try {
      request = draws.request(picture);
    } catch (error) {
      if (error instanceof ConnectorError) return { kind: 'undrawn', error: { kind: 'refused', code: error.code } };
      throw error;
    }
    const picked = await credentials.pool.pick(connection.value);
    if (!picked.ok) return { kind: 'undrawn', error: picked.failure };
    const failed = (error: Exclude<ReplyError, { kind: 'pool' }>): IllustrateFailure | Stopped => {
      if (error.kind === 'stopped') return { kind: 'stopped' };
      credentials.pool.stale(connection.value, picked.account);
      return { kind: 'undrawn', error };
    };
    const credential = await credentials.get(resolveConnection(connection.value)!, picked.account.secret, signal);
    if (!credential.ok) return failed(credential.failure);
    if (!spend) {
      if (!draws.free) return { kind: 'costs' };
      const asked = await relayJson(draws.free.request(credential.credential), signal);
      if (!asked.ok) return failed(asked.failure);
      if (draws.free.parse(asked.data, picture) !== true) return { kind: 'costs' };
    }
    const answer = await relayBytes({ ...request, headers: { ...request.headers, ...draws.authHeaders(credential.credential) } }, signal);
    if (!answer.ok) return failed(answer.failure);
    return (await draws.parse(answer.bytes, answer.type)) ?? { kind: 'not-a-picture' };
  }
}
