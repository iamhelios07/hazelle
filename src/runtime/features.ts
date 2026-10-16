import type { Chat } from '../model/chat';
import { FEATURE_STARTS, FEATURES, type Feature, type FeatureSwitches } from '../model/features';
import { without } from '../model/fields';
import { EMPTY_SETTINGS, SETTINGS_ID } from '../model/settings';
import type { ApiResult } from './api';
import { illustrateSwitches, translateSwitches, type IllustrateSetup, type TranslateSetup } from './characters';
import { chatPrompt } from './prompts';
import type { ObjectStore } from './store';

type Features = Record<Feature, boolean>;
type Reader = Pick<ObjectStore, 'get'>;
type Place = Pick<Chat, 'character' | 'prompt' | 'features'>;
export type FeatureOwner = { kind: 'settings' } | { kind: 'prompt' | 'character' | 'chat'; id: string };

// Nearest first: the first layer that sets a feature decides it (가까운 쪽을 따른다); one no layer sets starts as
// FEATURE_STARTS has it.
const decided = (layers: (FeatureSwitches | undefined)[]): Features =>
  Object.fromEntries(FEATURES.map((feature) => [feature, layers.find((layer) => layer?.[feature] !== undefined)?.[feature] ?? FEATURE_STARTS[feature]])) as Features;

const settingsLayer = (store: Reader) => store.get('settings', SETTINGS_ID)?.value.features;
const characterLayer = (store: Reader, character: string | null) => (character === null ? undefined : store.get('character', character)?.value.features);
function promptLayer(store: Reader, chat: Pick<Chat, 'prompt'>) {
  const prompt = chatPrompt(store, chat);
  return prompt.kind === 'prompt' ? prompt.prompt.value.features : undefined;
}

export const featuresOf = (store: Reader, chat: Place): Features => decided([chat.features, characterLayer(store, chat.character), promptLayer(store, chat), settingsLayer(store)]);

// 공용's, the farthest layer, which follows nothing.
export const sharedFeatures = (store: Reader): Features => decided([settingsLayer(store)]);

// What a layer that sets nothing reads: the layers past it. A character's is what a new chat of it reads, through the
// default prompt.
export function inherited(store: Reader, owner: Exclude<FeatureOwner, { kind: 'settings' }>): Features {
  if (owner.kind === 'prompt') return sharedFeatures(store);
  if (owner.kind === 'character') return decided([promptLayer(store, {}), settingsLayer(store)]);
  const chat = store.get('chat', owner.id)?.value;
  return chat ? featuresOf(store, { ...chat, features: undefined }) : sharedFeatures(store);
}

// The layer one that sets nothing follows: the next one up 공용 → 프롬프트 → 캐릭터 → 채팅, past a chat with no character.
export function above(store: Reader, owner: Exclude<FeatureOwner, { kind: 'settings' }>): 'settings' | 'prompt' | 'character' {
  if (owner.kind === 'prompt') return 'settings';
  if (owner.kind === 'character') return 'prompt';
  return store.get('chat', owner.id)?.value.character ? 'character' : 'prompt';
}

// null clears the layer's entry; a layer left with none drops the field, so it sets nothing.
export function setFeatureAt(store: ObjectStore, owner: FeatureOwner, feature: Feature, value: boolean | null): Promise<ApiResult<unknown>> {
  const set = <T extends { features?: FeatureSwitches }>(current: T): T => {
    const features = value === null ? without(current.features ?? {}, feature) : { ...current.features, [feature]: value };
    return Object.keys(features).length ? { ...current, features } : without(current, 'features');
  };
  if (owner.kind === 'settings') return store.upsert('settings', (current = EMPTY_SETTINGS) => set(current));
  if (owner.kind === 'prompt') return store.update('prompt', owner.id, (current) => (current.task === undefined ? set(current) : current));
  if (owner.kind === 'character') return store.update('character', owner.id, set);
  return store.update('chat', owner.id, set);
}

// A chat's switches with 번역's 기능 off: none runs. A reader with no chat (번역기, a card's translation) reads
// translateSwitches.
export function chatTranslate(store: Reader, chat: Place): TranslateSetup {
  const switches = translateSwitches(store, chat.character);
  return featuresOf(store, chat).translate ? switches : { ...switches, replies: false, input: false, reverse: false };
}

export function chatIllustrate(store: Reader, chat: Place): IllustrateSetup {
  const switches = illustrateSwitches(store, chat.character);
  return featuresOf(store, chat).illustrate ? switches : { ...switches, auto: false };
}
