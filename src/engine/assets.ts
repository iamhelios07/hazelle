// A bot's own picture or video (design §6.4). module: the namespace of the module it came with, null for a module that has none;
// absent for the character's own.
export type BotAsset = { id: string; name: string; type: string; module?: string | null };

// A kept asset is a picture or a video (engine/import assetType).
export const isVideo = (type: string) => type.startsWith('video/');

// A stored picture by its kind and id: a bot's asset, a chat's inlay, or a 삽화 (illustration), which only an export names
// this way.
export type PictureKind = 'asset' | 'inlay' | 'illustration';
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
export const inlayPicture = (id: string) => `<img src="${pictureRef('inlay', id)}">`;
export const inlayBlock = (id: string) => `<div class="risu-inlay-image">${inlayPicture(id)}</div>`;
// The type of an inlay holding a Gemini thought signature's item, which is no picture.
export const SIGNATURE = 'signature';
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
  const target = bare(wanted);
  let nearest: A | null = null;
  let best = NEAR + 1;
  for (const asset of assets) {
    const distance = edits(target, bare(asset.name.toLowerCase()));
    if (distance < best) [nearest, best] = [asset, distance];
  }
  return nearest;
}

function edits(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    row = next;
  }
  return row[b.length]!;
}
