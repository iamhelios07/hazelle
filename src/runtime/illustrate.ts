import { ChangeSignal } from '../change-signal';
import type { ModelRef } from '../connectors/assignment';
import { resolveConnection } from '../connectors/registry';
import { ConnectorError, type Draws, type HttpRequest, type Picture, type PictureRequest } from '../connectors/types';
import { parseScene, pictureRequest, type SceneInvalid } from '../engine/illustrate';
import type { RanAway } from '../engine/pipeline';
import { fold, type Receipt } from '../model/chat';
import { without } from '../model/fields';
import { paragraphsOf, type Illustration, type Scene } from '../model/illustration';
import type { Stored } from '../model/kinds';
import { live } from '../model/library';
import type { ApiFailure } from './api';
import { taskModel, type Route, type RouteFailure } from './assignment';
import { illustrateSwitches } from './characters';
import { pinned, scopeOf } from './chat-context';
import { evaluationFailure } from './evaluation';
import { generate, type ReplyError } from './generate';
import { modelProfile } from './profiles';
import { illustrationPrompt } from './prompts';
import { relayBytes } from './relay';
import type { Session } from './session';
import { callOf, endCall, pageCall } from './streams';
import { receiptOf } from './talk';

// 삽화 (design §6.6): one picture per message per run, from one scene call to the chat's 보조 model (or the 삽화
// prompt's own) and one image call. The only writer of `illustration` objects but a backup's restore and a chat's copies.

export type ImageRoute = Route & { draws: Draws };

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
// gone: the message or its version was deleted, or holds no text to draw from.
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
  | { kind: 'file-refused' }
  | { kind: 'gone' }
  | { kind: 'unsaved'; failure: ApiFailure };

// By message, one run each. scene: once written, so the chat shows the 그리는 중 slot after its paragraph; on a failure,
// the scene it had, which a retry draws again without another scene call.
export type Drawing = { chat: string; version: string } & ({ stage: 'scene' } | { stage: 'drawing'; scene: Scene } | { stage: 'failed'; failure: IllustrateFailure; scene: Scene | null });
export type Illustrating = ReadonlyMap<string, Drawing>;

type Stopped = { kind: 'stopped' };
type Deps = Pick<Session, 'store' | 'credentials' | 'files'>;

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
    if (drawing) next.set(message, drawing);
    else next.delete(message);
    this.state = next;
    this.changes.notify();
  }

  // scene: one the user changed (어떻게 바꿀까요?) or a failed run's, drawn with no scene call. auto: asked by a reply
  // received here, whose scene a chat judged stuck refuses (evaluation's passive gate).
  // 다시 그리기 is another draw: earlier pictures of the version stay.
  draw(chat: string, message: string, version: string, { scene = null, auto = false }: { scene?: Scene | null; auto?: boolean } = {}) {
    if (this.closed || this.aborts.has(message)) return;
    const abort = new AbortController();
    this.aborts.set(message, abort);
    this.change(message, scene ? { chat, version, stage: 'drawing', scene } : { chat, version, stage: 'scene' });
    const lease = this.deps.store.retainChat(chat);
    let written: Scene | null = scene;
    void lease.ready
      .then(async (failure) => {
        if (failure) return { kind: 'unsaved' as const, failure };
        return this.run(chat, message, version, scene, auto, abort.signal, (made) => {
          written = made;
          this.change(message, { chat, version, stage: 'drawing', scene: made });
        });
      })
      .then(
        (outcome) => this.change(message, outcome === null || outcome.kind === 'stopped' ? null : { chat, version, stage: 'failed', failure: outcome, scene: written }),
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

  close() {
    this.closed = true;
    for (const abort of this.aborts.values()) abort.abort();
  }

  // null once the illustration is saved.
  private async run(chat: string, message: string, version: string, given: Scene | null, auto: boolean, signal: AbortSignal, onScene: (scene: Scene) => void): Promise<IllustrateFailure | Stopped | null> {
    const { store, files } = this.deps;
    const stored = live(store.get('chat', chat));
    const messages = fold(store.children('entry', chat));
    const index = messages.findIndex(({ id }) => id === message);
    const selected = messages[index]?.versions.findIndex(({ id }) => id === version) ?? -1;
    if (!stored || selected === -1) return { kind: 'gone' };
    const text = messages[index]!.versions[selected]!.text;
    const switches = illustrateSwitches(store, stored.value.character);
    const route = imageRoute(store, switches.model);
    if ('kind' in route) return route;
    let scene = given;
    let receipt: Receipt | null = null;
    if (!scene) {
      const paragraphs = paragraphsOf(text);
      if (!paragraphs.length) return { kind: 'gone' };
      const history = [...messages.slice(0, index), { ...messages[index]!, selected }];
      const written = await this.scene(chat, stored.value, history, paragraphs, switches.prompt, auto, signal);
      if ('kind' in written) return written;
      ({ scene, receipt } = written);
      onScene(scene);
    }
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]!;
    const request = pictureRequest(scene, route.model, seed);
    const drawn = await this.picture(route, request, signal);
    if ('kind' in drawn) return drawn;
    const saved = await files.save([drawn.bytes], { signal });
    if (!saved.ok) return saved.error === 'stopped' ? { kind: 'stopped' } : { kind: 'unsaved', failure: saved };
    const file = saved.data[0];
    if (!file) return { kind: 'file-refused' };
    const illustration: Illustration = { message, version, scene, receipt, model: { connection: route.connection.id, model: route.model.id }, sent: without(request, 'model'), file, type: drawn.type, size: drawn.bytes.byteLength, at: Date.now() };
    const created = await store.create('illustration', illustration, { parent: chat });
    return created.ok ? null : { kind: 'unsaved', failure: created };
  }

  // The scene call reads through the server's stream like any model call, but leaves no marker: a pick-up on another
  // device would draw the picture again and pay for it twice.
  private async scene(chat: string, value: Stored<'chat'>['value'], history: ReturnType<typeof fold>, paragraphs: string[], chosen: string | undefined, auto: boolean, signal: AbortSignal): Promise<{ scene: Scene; receipt: Receipt } | IllustrateFailure | Stopped> {
    const { store, credentials } = this.deps;
    const prompt = illustrationPrompt(store, chosen);
    if (prompt.kind === 'missing') return { kind: 'prompt-missing', own: prompt.own };
    const route = taskModel(store, value, prompt.prompt.value.model);
    if ('kind' in route) return route;
    const profile = modelProfile(store, route.model);
    if (profile.kind === 'missing') return { kind: 'profile-missing', own: profile.own };
    const lane = { asker: auto ? ('auto-illustration' as const) : ('illustration' as const), chat };
    const scope = scopeOf({ store }, chat, value, history);
    const assembled = await store.evaluation.illustration(lane, { scope, take: pinned({ store }, value), prompt: prompt.prompt.value, index: history.length - 1, paragraphs, seed: crypto.randomUUID() }, signal).catch((error: unknown) => {
      const failure = evaluationFailure(error);
      return failure.error === 'stopped' ? { kind: 'stopped' as const } : { kind: 'unsaved' as const, failure };
    });
    if ('kind' in assembled) return assembled;
    let text = '';
    const call = await pageCall(null);
    const answer = await generate({ credentials, connection: route.connection.value, model: route.model, settings: profile.profile.value.settings, messages: assembled.messages, call, signal, onText: (phase, chunk) => { if (phase === 'text') text += chunk; } }).finally(() => endCall(store, call.id));
    if (answer.cut === 'stopped') return { kind: 'stopped' };
    const made = receiptOf(callOf(route), answer);
    // Not settled later, as a memory record's is not.
    const receipt = made.cost === 'pending' ? { ...made, cost: null } : made;
    if (answer.state !== 'done') return { kind: 'failed', receipt };
    const parsed = parseScene(text, paragraphs.length);
    return parsed.ok ? { scene: parsed.scene, receipt } : { kind: 'invalid', receipt, reason: parsed.reason };
  }

  // Straight through the relay: a picture is one answer, not a stream to pick up.
  private async picture({ connection, draws }: ImageRoute, picture: PictureRequest, signal: AbortSignal): Promise<Picture | IllustrateFailure | Stopped> {
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
    const answer = await relayBytes({ ...request, headers: { ...request.headers, ...draws.authHeaders(credential.credential) } }, signal);
    if (!answer.ok) return failed(answer.failure);
    return (await draws.parse(answer.bytes, answer.type)) ?? { kind: 'not-a-picture' };
  }
}
