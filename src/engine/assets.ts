import { nearest } from './edit-distance';

// A bot's own picture or video (design §6.4). module: the namespace of the module it came with, null for a module that has none;
// absent for the character's own.
export type BotAsset = { id: string; name: string; type: string; module?: string | null };

// A kept asset is a picture or a video (engine/import assetType).
export const isVideo = (type: string) => type.startsWith('video/');

// A stored picture by its kind and id: a bot's asset, a chat's inlay, a 삽화 (illustration), which only an export names
// this way, or a character's avatar, which no text names (PICTURE_REF leaves it out).
export type PictureKind = 'asset' | 'inlay' | 'illustration' | 'avatar';
export type PictureUrl = (kind: PictureKind, id: string) => string | undefined;

// The chat screen puts the picture's own URL there once it is loaded (resolveAssets), and nothing before.
export const pictureRef = (kind: PictureKind, id: string) => `${kind}:${id}`;
export const assetUrl = (id: string) => pictureRef('asset', id);
const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PICTURE_REF = new RegExp(`(asset|inlay|illustration):(${ID})`, 'g');

export const resolveAssets = (text: string, url: PictureUrl) => text.replace(PICTURE_REF, (_, kind: PictureKind, id: string) => url(kind, id) ?? '');

// The app's own markup for a chat's inlay, which engine/cbs/tags.ts writes: the one HTML the display keeps without the
// bot's style (engine/display.ts). Story.tsx names the mark's attribute again, to give it its text.
export const inlayMissing = '<span data-inlay-missing></span>';
export const inlayPicture = (id: string) => `<img src="${pictureRef('inlay', id)}"/>`;
export const inlayBlock = (id: string) => `<div class="risu-inlay-image">${inlayPicture(id)}</div>`;
// The type of an inlay holding a Gemini thought signature's item, which is no picture.
export const SIGNATURE = 'signature';
// Risu's inlay tags, drawn after the display regex as Risu draws them (parseInlayAssets), so a bot's regex sees the tags
// and never the picture. Items of Risu's inlay store, which the chat holds by the tag's id exactly, never by findAsset's
// near match. A signature is never drawn; an item the chat lacks shows the app's mark.
const INLAY_TAG = /\{\{(inlay|inlayed|inlayeddata)::(.+?)\}\}/g;
export const placeInlays = (text: string, inlays: readonly { id: string; name: string; type: string }[]) =>
  text.replace(INLAY_TAG, (_, kind: string, name: string) => {
    const inlay = inlays.find((each) => each.name === name);
    if (!inlay) return inlayMissing;
    if (inlay.type === SIGNATURE) return '';
    return kind === 'inlay' ? inlayPicture(inlay.id) : `${inlayBlock(inlay.id)}\n`;
  });
const pattern = (markup: string) => markup.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace('@', ID);
// Sticky: it matches only where its lastIndex stands. Group 1: the wrapped picture, a block of its own.
export const INLAY_MARKUP = new RegExp(`${pattern(inlayMissing)}|(${pattern(inlayBlock('@'))})|${pattern(inlayPicture('@'))}`, 'y');

// Risu's distance for a name that matches none: models write names from {{assetlist}} and often get one slightly wrong.
const NEAR = 4;
const EXTENSIONS = /\.(webp|png|jpe?g|gif|mp4|webm|avi|m4p|m4v|mp3|wav|ogg)$/;
const bare = (name: string) => name.replace(EXTENSIONS, '').trim().replace(/[\s_.-]/g, '');

// As Risu finds one: the name in any case, one of several that share it by the tag's own roll; else the name nearest
// within NEAR edits, its extension and separators aside.
export function findAsset<A extends { name: string }>(assets: readonly A[], name: string, random: () => number): A | null {
  const wanted = name.toLowerCase();
  const same = assets.filter((asset) => asset.name.toLowerCase() === wanted);
  if (same.length) return same[Math.floor(random() * same.length)]!;
  return nearest(bare(wanted), assets, (asset) => bare(asset.name.toLowerCase()), NEAR);
}
