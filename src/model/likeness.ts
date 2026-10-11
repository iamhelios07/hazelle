import type { Receipt } from './chat';

// 삽화 profiles (design §6.6): how the characters a pack describes look, as Danbooru tags, so every picture draws them
// alike. One object per pack at likenessId(owner), made on the first 삽화 that needs it and again only on 다시 만들기.

// metadata: read from NovelAI's own prompt kept in the pack's pictures; vision: a model looked at them; text: written
// from the description and lorebook alone.
export type PortraitSource = 'metadata' | 'vision' | 'text';
export type Outfit = { name: string; tags: string };

// aliases: other names the story calls them by, matched like name. outfits: the first is what they wear unless a scene
// says otherwise. artist: the artist tags the bot's own pictures were drawn with, empty when none are known.
export type Portrait = { name: string; aliases: string[]; look: string; outfits: Outfit[]; artist: string; source: PortraitSource };

// receipt: the call that wrote it. portraits empty: the pack describes no one's looks, which is kept so no draw asks again.
export type Likeness = { portraits: Portrait[]; at: number; receipt: Receipt | null };

// Ruled 2026-10-11: the characters past this are written per scene, as before profiles.
export const PORTRAITS_MOST = 8;

const inverted = (group: string) => [...group].map((digit) => (15 - parseInt(digit, 16)).toString(16)).join('');

// The owner's id with its second group's hex digits inverted, the same on every device, so two devices making a pack's
// likeness at once meet in a version conflict instead of making two (as model/memory memoryId).
export const likenessId = (owner: string) => owner.replace(/^([0-9a-f]{8}-)([0-9a-f]{4})/, (_, head: string, group: string) => head + inverted(group));
