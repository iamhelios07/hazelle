import { modelSettings } from '../connectors/registry';
import { fit, type ModelSettings } from '../connectors/settings';
import type { Starred } from '../connectors/types';
import type { Display } from '../engine/display';
import { readToggles } from '../engine/import/toggles';
import type { Card, Pack } from '../engine/import/types';
import type { Box } from '../engine/regex/scripts';
import type { ChatScope } from '../engine/render';
import type { TranslationRequest } from '../engine/translate';
import { shown, type Chat, type Message } from '../model/chat';
import { live } from '../model/library';
import type { Toggle } from '../model/prompt';
import { SETTINGS_ID } from '../model/settings';
import { chatToggles, toggleValue } from '../model/toggles';
import { chatModel, type Route } from './assignment';
import { translateSwitches } from './characters';
import { greetingOf } from './greetings';
import { chatPersona } from './personas';
import { modelProfile } from './profiles';
import { chatPrompt, type PromptChoice } from './prompts';
import type { ObjectStore } from './store';
import type { Shown } from './talk';
import type { TranslateInput } from './translate';

type Reader = { store: Pick<ObjectStore, 'get' | 'children'> };

// Order (design §6.5): its character's own, then the modules on in every chat, then its prompt's, then the
// character's, each once where it first appears. A module that is gone or deleted is off.
// module: null for the character's own pack.
export function packsOf(store: Reader['store'], chat: Pick<Chat, 'character' | 'prompt'>): { id: string; pack: Pack; module: { namespace: string | null } | null }[] {
  const character = chat.character === null ? null : store.get('character', chat.character);
  const prompt = chatPrompt(store, chat);
  const modules = [...new Set([...(store.get('settings', SETTINGS_ID)?.value.modules ?? []), ...(prompt.kind === 'prompt' ? (prompt.prompt.value.modules ?? []) : []), ...(character?.value.modules ?? [])])];
  return [
    ...(character ? [{ id: character.id, pack: character.value.card, module: null }] : []),
    ...modules.flatMap((id) => {
      const module = store.get('module', id)?.value;
      return module && module.deleted === undefined ? [{ id, pack: module, module: { namespace: module.namespace } }] : [];
    }),
  ];
}

// id is null for a chat not saved yet.
export function scopeOf({ store }: Reader, id: string | null, chat: Chat, messages: Message[]): ChatScope {
  const character = chat.character === null ? null : (store.get('character', chat.character)?.value ?? null);
  const card = character?.card ?? null;
  const packs = packsOf(store, chat);
  const cast = (chat.cast ?? []).flatMap((member) => live(store.get('character', member)) ?? []);
  // A 등장인물's lorebook and pictures follow the packs', its pictures with no module namespace, as the character's own.
  const owners = [...packs, ...cast.map(({ id }) => ({ id, module: null }))];
  const prompt = chatPrompt(store, chat);
  const persona = chatPersona(store, chat);
  const route = chatModel(store, chat, 'main');
  const toggles = togglesOf(store, chat, prompt);
  return {
    card,
    cast: cast.map(({ id, value }) => ({ id, card: value.card })),
    packs: packs.map(({ pack }) => pack),
    persona: persona.kind === 'persona' ? { name: persona.persona.value.name, description: persona.persona.value.description } : null,
    prompt: prompt.kind === 'prompt' ? prompt.prompt.value : null,
    note: chat.note ?? null,
    lore: owners.flatMap(({ id: owner }) => store.children('lore', owner)),
    messages: messages.map((message) => {
      const version = shown(message);
      const after = [...(version.after ?? []), ...(message.after ?? [])];
      return { id: version.id, seed: version.seed, role: message.role, text: version.text, time: version.at, ...(version.staged && { staged: true }), ...(version.before && { before: version.before }), ...(after.length > 0 && { after }) };
    }),
    variables: chat.variables ?? [],
    greeting: card && greetingOf(messages),
    toggles: new Map(toggles.declared.map(({ key }) => [key, toggles.value(key)])),
    model: 'kind' in route ? null : botModel(route, sentSettings(store, route)),
    clock: { now: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
    assets: owners.flatMap(({ id: owner, module }) => store.children('asset', owner).map(({ id, value }) => ({ id, name: value.name, ...(module && { module: module.namespace }) }))),
    modules: packs.flatMap(({ module }) => module?.namespace ?? []),
    faces: {
      char: chat.character === null ? null : (store.children('avatar', chat.character)[0]?.value.thumb ?? null),
      user: persona.kind === 'persona' ? persona.persona.value.picture : null,
    },
    screen: null,
    pick: `${chat.character ?? ''}:${chat.seed ?? id ?? ''}`,
  };
}

export type ChatToggleSet = { declared: Toggle[]; value: (key: string) => string | null };

export function togglesOf(store: Reader['store'], chat: Chat, prompt: PromptChoice): ChatToggleSet {
  const character = chat.character === null ? null : (store.get('character', chat.character)?.value ?? null);
  const declared = chatToggles(prompt.kind === 'prompt' ? prompt.prompt.value.toggles : [], packsOf(store, chat).flatMap(({ pack }) => readToggles(pack.toggles).toggles));
  return { declared, value: toggleValue(declared, (character ? character.toggles : store.get('settings', SETTINGS_ID)?.value.toggles) ?? {}) };
}

// null while its 묶음 is missing, which a turn stops on.
export function sentSettings(store: Reader['store'], { connection, model }: Route): ModelSettings | null {
  const profile = modelProfile(store, model);
  if (profile.kind === 'missing') return null;
  const schema = modelSettings(connection.value, model);
  return schema ? fit(schema, profile.profile.value.settings).settings : profile.profile.value.settings;
}

const contextOf = (model: Starred, settings: ModelSettings | null) => settings?.context ?? model.contextLength;
const replyOf = (model: Starred, settings: ModelSettings | null) => settings?.maxOutput ?? model.maxOutput;

function botModel(route: Route, settings: ModelSettings | null): ChatScope['model'] {
  const { connection, model } = route;
  return { id: model.id, maxContext: contextOf(model, settings), prefill: modelSettings(connection.value, model)?.prefill ?? null };
}

// A reply length nobody knows reserves nothing.
export function budgetOf(model: Starred, settings: ModelSettings | null): number | null {
  const context = contextOf(model, settings);
  return context === null ? null : context - (replyOf(model, settings) ?? 0);
}

// null when the chat has no 대화 모델 or the context is unknown.
export function promptBudget(store: Reader['store'], chat: Chat): number | null {
  const route = chatModel(store, chat, 'main');
  return 'kind' in route ? null : budgetOf(route.model, sentSettings(store, route));
}

// A chat's messages as a request sends them: under 반전 모드, each with its shown version's translation as its text.
export const asSent = (store: Reader['store'], chat: Chat, messages: Message[]) => (translateSwitches(store, chat.character).reverse ? messages.map(reversed) : messages);

// screen: the window the chat is shown in, for a bot's layout; null for what is not shown, such as a preview.
export const evaluateChat = async (reader: { store: Reader['store'] & Pick<ObjectStore, 'evaluation'> }, id: string | null, chat: Chat, messages: Message[], screen: ChatScope['screen'] = null, signal?: AbortSignal): Promise<Display> =>
  (await reader.store.evaluation.display(`headless:${id}`, { ...scopeOf(reader, id, chat, messages), screen }, pinned(reader, chat), signal)).display;

// 상태창 지정's scripts at their places among a chat's scripts, which the engine knows them by. The character's pack
// comes first (packsOf), so a place in card.regex is the same place there. An id that names no script marks nothing,
// nor does one turned off, which never draws; its mark is kept for when it is turned on.
export type StatusScript = { id: string; place: number };
export const statusPlaces = (card: Pick<Card, 'regex'>, ids: readonly string[]): StatusScript[] =>
  ids.flatMap((id) => {
    const place = card.regex.findIndex((script) => script.id === id);
    return place === -1 || card.regex[place]!.off ? [] : [{ id, place }];
  });

// The status window's scripts (상태창 지정), whose boxes leave every message and what is translated of it, unless
// 봇 스타일 is off; the chat draws the latest box itself.
export function pinned({ store }: Reader, chat: Chat): ReadonlySet<number> {
  const character = chat.character === null ? null : store.get('character', chat.character)?.value;
  return new Set(!character || character.decor === false ? [] : statusPlaces(character.card, character.statusScripts ?? []).map(({ place }) => place));
}

// A reply still being written is passed over, since half a box would show; so is a box its script left empty, as bots
// do on older messages. null: no message drew one yet.
export type StatusBox = StatusScript & { drawn: (Box & { message: number }) | null };

export function statusBoxes(shown: Display, messages: Shown[], scripts: readonly StatusScript[]): StatusBox[] {
  return scripts.map((script) => {
    for (let index = messages.length - 1; index >= 0; index--) {
      if (messages[index]!.live !== null) continue;
      const box = shown.boxes[index]!.find((each) => each.script === script.place);
      if (box?.html.trim()) return { ...script, drawn: { ...box, message: index } };
    }
    return { ...script, drawn: null };
  });
}

// A reply goes into the switches' replyLanguage and the user's message into their inputLanguage.
export function translationInput(reader: Reader, id: string, chat: Chat, messages: Message[], request: TranslationRequest): TranslateInput {
  const switches = translateSwitches(reader.store, chat.character);
  const language = request.kind === 'message' ? switches.replyLanguage : switches.inputLanguage;
  return { chat, scope: scopeOf(reader, id, chat, messages), take: pinned(reader, chat), translations: messages.map((message) => shown(message).translation?.text ?? null), request, language };
}

function reversed(message: Message): Message {
  const version = shown(message);
  return version.translation ? { ...message, versions: message.versions.with(message.selected, { ...version, text: version.translation.text }) } : message;
}
