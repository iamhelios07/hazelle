import { ChangeSignal } from '../change-signal';
import { seesPictures, type InputPicture, type Model } from '../connectors/types';
import { artistTags, picturePrompt } from '../engine/import/picture-prompt';
import { artistOf, likenessRequest, parseLikeness, sample, SAMPLE_MOST, SHOWN_MOST, sourcesOf, type LikenessInvalid } from '../engine/likeness';
import type { Chat, Receipt } from '../model/chat';
import type { Stored } from '../model/kinds';
import { live, type Asset } from '../model/library';
import { likenessId, PORTRAITS_MOST, type Likeness, type Portrait } from '../model/likeness';
import type { IllustratePrompt } from '../model/prompt';
import type { ApiFailure, ApiResult } from './api';
import type { RouteFailure } from './assignment';
import { illustrateSwitches } from './characters';
import { packsOf } from './chat-context';
import { chatPersona } from './personas';
import { refreshStarred } from './connections';
import { gather, generate } from './generate';
import { illustrateWriter } from './illustrate';
import { shownPicture } from './picture';
import { illustrationPrompt } from './prompts';
import type { Session } from './session';
import type { ObjectStore } from './store';
import { callOf, endCall, pageCall } from './streams';
import { receiptOf, unsettled } from './talk';
import { keepRow } from './usage';
import { fromBase64 } from '../vault/aead';

// 삽화 profiles (design §6.6): the only writer of `likeness` objects but a backup's restore and a character's copy. A
// pack's are made on the first 삽화 that needs them and again only on 다시 만들기, so a bot never drawn costs nothing.

// unread: a picture could not be fetched, so nothing is written and the next draw tries again. gone: the pack was
// deleted.
export type LikenessFailure =
  | RouteFailure
  | { kind: 'prompt-missing'; own: boolean }
  | { kind: 'profile-missing'; own: boolean }
  | { kind: 'unread'; failure: ApiFailure }
  | { kind: 'failed'; receipt: Receipt }
  | { kind: 'invalid'; receipt: Receipt; reason: LikenessInvalid }
  | { kind: 'unsaved'; failure: ApiFailure }
  | { kind: 'gone' };

// By pack. A failure stays for the session, until the next try.
export type LikenessRun = { stage: 'building' } | { stage: 'failed'; failure: LikenessFailure };
export type LikenessRuns = ReadonlyMap<string, LikenessRun>;

type Stopped = { kind: 'stopped' };
type Deps = Pick<Session, 'store' | 'credentials' | 'files' | 'catalogs'>;
type Picture = Pick<Asset, 'name' | 'type' | 'file'> & { avatar: boolean };
type Held = { name: string; type: string; avatar: boolean; bytes: Uint8Array<ArrayBuffer> };
// files: pictures still to read; held: one already in the owner's value, a persona's thumb.
type Material = { name: string; user: boolean; texts: { label: string; text: string }[]; lore: { name: string; keys: string[]; content: string }[]; files: Picture[]; held: Held[] };

// A file gone or not opening is left out; any other failure ends the build.
const PERMANENT = new Set(['not-found', 'unreadable']);

// Replaces what is there: 다시 만들기, or another device's build met in a conflict.
async function writeLikeness(store: ObjectStore, owner: string, value: Likeness): Promise<ApiResult<Stored<'likeness'>>> {
  const id = likenessId(owner);
  if (!store.get('likeness', id)) {
    const created = await store.create('likeness', value, { id, parent: owner });
    if (created.ok || created.error !== 'conflict' || !store.get('likeness', id)) return created;
  }
  return store.update('likeness', id, () => value);
}

// Only tags are edited (the 삽화 part); a portrait or outfit gone meanwhile is not written back ('gone').
export type PortraitEdit = { look: string } | { artist: string } | { outfit: string; tags: string };

export function editPortrait(store: ObjectStore, owner: string, name: string, edit: PortraitEdit): Promise<ApiResult<Stored<'likeness'>>> {
  return store.update('likeness', likenessId(owner), (current) => {
    const at = current.portraits.findIndex((portrait) => portrait.name === name);
    const portrait = current.portraits[at];
    if (!portrait) return null;
    let edited: Portrait;
    if ('look' in edit) edited = { ...portrait, look: edit.look };
    else if ('artist' in edit) edited = { ...portrait, artist: edit.artist };
    else {
      const outfit = portrait.outfits.findIndex(({ name: named }) => named === edit.outfit);
      if (outfit === -1) return null;
      edited = { ...portrait, outfits: portrait.outfits.with(outfit, { ...portrait.outfits[outfit]!, tags: edit.tags }) };
    }
    return { ...current, portraits: current.portraits.with(at, edited) };
  });
}

// One build per pack at a time: a draw that needs a pack being built waits for that build.
export class Likenesses {
  private closed = false;
  private state: LikenessRuns = new Map();
  private readonly building = new Map<string, Promise<void>>();
  private readonly closing = new AbortController();
  private readonly changes = new ChangeSignal();

  constructor(private readonly deps: Deps) {}

  readonly subscribe = this.changes.subscribe;

  readonly snapshot = () => this.state;

  private change(owner: string, run: LikenessRun | null) {
    const next = new Map(this.state);
    if (run) next.set(owner, run);
    else next.delete(owner);
    this.state = next;
    this.changes.notify();
  }

  // The chat's packs' portraits in pack order (chat-context packsOf), then its 등장인물's and its persona's, those
  // without any built first. A build that fails leaves its owner out of this draw; the picture is drawn all the same.
  // prompt: the 삽화 prompt the draw uses, whose model writes them.
  async portraits(chat: Chat, prompt: IllustratePrompt, signal: AbortSignal): Promise<Portrait[]> {
    const { store } = this.deps;
    // A 등장인물 is drawn from its own card's portraits, after the packs, as its lorebook and pictures are read.
    const cast = (chat.cast ?? []).filter((member) => live(store.get('character', member)));
    const persona = chatPersona(store, chat);
    const owners = [...new Set([...packsOf(store, chat).map(({ id }) => id), ...cast, ...(persona.kind === 'persona' ? [persona.persona.id] : [])])];
    await Promise.all(owners.filter((owner) => !store.get('likeness', likenessId(owner))).map((owner) => this.start(owner, chat, prompt, signal)));
    return owners.flatMap((owner) => store.get('likeness', likenessId(owner))?.value.portraits ?? []);
  }

  // 다시 만들기, from the owner's own screen: written as a new chat of the character would draw (a module's or a
  // persona's as a new 캐릭터 없이 chat's), and replacing what is there. One under way is not started again.
  rebuild(owner: string) {
    const { store } = this.deps;
    const character = live(store.get('character', owner)) ? owner : null;
    const persona = live(store.get('persona', owner)) ? { persona: owner } : {};
    const prompt = illustrationPrompt(store, illustrateSwitches(store, character).prompt);
    if (prompt.kind === 'missing') return this.change(owner, { stage: 'failed', failure: { kind: 'prompt-missing', own: prompt.own } });
    void this.start(owner, { title: null, character, models: {}, ...persona }, prompt.prompt.value, this.closing.signal);
  }

  close() {
    this.closed = true;
    this.closing.abort();
  }

  // signal: the draw's that asked first; a draw joining it goes on without the pack's portraits if it stops.
  private start(owner: string, chat: Chat, prompt: IllustratePrompt, signal: AbortSignal): Promise<void> {
    const running = this.building.get(owner);
    if (running || this.closed) return running ?? Promise.resolve();
    this.change(owner, { stage: 'building' });
    const run = this.build(owner, chat, prompt, AbortSignal.any([signal, this.closing.signal]))
      .then(
        (outcome) => this.change(owner, outcome === null || outcome.kind === 'stopped' ? null : { stage: 'failed', failure: outcome }),
        (error: unknown) => {
          this.change(owner, null);
          throw error;
        },
      )
      .finally(() => this.building.delete(owner));
    this.building.set(owner, run);
    return run;
  }

  // A persona has no lorebook and one picture, the small copy its value holds.
  private material(owner: string): Material | null {
    const { store } = this.deps;
    const persona = live(store.get('persona', owner));
    if (persona) {
      const { name, description, picture } = persona.value;
      const [, type, data] = (picture && /^data:([^;,]+);base64,(.*)$/.exec(picture)) || [];
      return { name, user: true, texts: [{ label: 'Description', text: description }], lore: [], files: [], held: type && data ? [{ name: '', type, avatar: true, bytes: fromBase64(data) }] : [] };
    }
    const character = live(store.get('character', owner));
    const module = character ? null : live(store.get('module', owner));
    if (!character && !module) return null;
    const card = character?.value.card;
    const texts = card
      ? [{ label: 'Description', text: card.description }, { label: 'Personality', text: card.personality }, { label: 'Scenario', text: card.scenario }]
      : [{ label: 'Description', text: module!.value.description }];
    const lore = store.children('lore', owner).flatMap(({ value }) => (value.enabled ? [{ name: value.name, keys: value.keys, content: value.content }] : []));
    const avatar = store.children('avatar', owner)[0]?.value;
    const files: Picture[] = [
      ...(avatar ? [{ name: '', type: avatar.type, file: avatar.file, avatar: true }] : []),
      ...sample(store.children('asset', owner).flatMap(({ value }) => (value.type.startsWith('image/') ? [{ ...value, avatar: false }] : [])), SAMPLE_MOST - (avatar ? 1 : 0)),
    ];
    return { name: card?.name ?? module!.value.name, user: false, texts, lore, files, held: [] };
  }

  // Sources (design §6.6): the pictures' NovelAI metadata, the pictures themselves for a model that sees them, and the
  // owner's text with its lorebook. An owner with none of them gets no call and nothing saved, so a description
  // written later (an account's first persona starts blank) is read on the next draw.
  private async build(owner: string, chat: Chat, prompt: IllustratePrompt, signal: AbortSignal): Promise<LikenessFailure | Stopped | null> {
    const { store, files, credentials } = this.deps;
    const material = this.material(owner);
    if (!material) return { kind: 'gone' };
    const { texts, lore } = material;
    const save = async (value: Likeness) => {
      const saved = await writeLikeness(store, owner, value);
      if (saved.ok && value.receipt) await keepRow(store, value.receipt, value.at, { chat: null, character: store.get('character', owner) ? owner : null });
      return saved.ok ? null : { kind: 'unsaved' as const, failure: saved };
    };
    const empty = { portraits: [], at: Date.now(), receipt: null };
    if (!material.files.length && !material.held.length && !texts.some(({ text }) => text.trim()) && !lore.some(({ content }) => content.trim())) return null;
    const writer = illustrateWriter(store, chat, prompt);
    if ('kind' in writer) return writer;

    const read = await Promise.all(material.files.map(async (picture) => ({ picture, read: await files.read(picture.file, { signal }) })));
    const failed = read.find(({ read }) => !read.ok && !PERMANENT.has(read.error))?.read;
    if (failed && !failed.ok) return failed.error === 'stopped' ? { kind: 'stopped' } : { kind: 'unread', failure: failed };
    const held: Held[] = [...material.held, ...read.flatMap(({ picture, read }) => (read.ok ? [{ ...picture, bytes: read.data }] : []))];
    const prompts = held.flatMap(({ bytes }) => picturePrompt(bytes) ?? []);
    const shown = (await seesNow(this.deps, writer.route)) ? await shownPictures(held.slice(0, SHOWN_MOST)) : [];
    const input = { name: material.name, user: material.user, texts, lore, prompts, pictures: shown.map(({ shown }) => shown), avatar: shown[0]?.avatar === true, most: PORTRAITS_MOST };
    const sources = sourcesOf(input);
    if (!sources.length) return save(empty);

    const text = gather();
    const call = await pageCall(null);
    const answer = await generate({ credentials, connection: writer.route.connection.value, model: writer.route.model, settings: writer.settings, messages: likenessRequest(input), call, signal, onText: text.add }).finally(() => endCall(store, call.id));
    if (answer.cut === 'stopped') return { kind: 'stopped' };
    const receipt = unsettled(receiptOf(callOf(writer.route), answer));
    if (answer.state !== 'done') return { kind: 'failed', receipt };
    const parsed = parseLikeness(text.value(), { sources, artist: artistOf(prompts.map(({ prompt }) => artistTags(prompt))), most: PORTRAITS_MOST });
    return parsed.ok ? save({ portraits: parsed.portraits, at: Date.now(), receipt }) : { kind: 'invalid', receipt, reason: parsed.reason };
  }
}

// A model starred before its catalog's inputs were filled from models.dev keeps an unknown input in its starred copy,
// which only opening its model list refreshes; asked here, so a profile is not built blind for that.
async function seesNow({ store, catalogs }: Deps, { connection, model }: { connection: Stored<'connection'>; model: Model }): Promise<boolean> {
  if (model.input !== null) return seesPictures(model);
  const listed = await catalogs.load(connection.value);
  if (!listed.ok) return false;
  await refreshStarred(store, connection.id, listed.models);
  return seesPictures(listed.models.find(({ id }) => id === model.id) ?? model);
}

// A picture the browser cannot draw is left out.
async function shownPictures(pictures: Held[]): Promise<{ shown: InputPicture; avatar: boolean }[]> {
  const shown = await Promise.all(pictures.map(({ bytes, type, avatar }) => shownPicture({ bytes, type }).then((picture) => ({ shown: picture, avatar }), () => null)));
  return shown.filter((each) => each !== null);
}
