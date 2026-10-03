// A bot's own picture (design §6.4). module: the namespace of the module it came with, null for a module that has none;
// absent for the character's own.
export type BotAsset = { id: string; name: string; module?: string | null };

// The chat screen puts the picture's own URL there once it is loaded (resolveAssets), and nothing before.
export const assetUrl = (id: string) => `asset:${id}`;
const ASSET_URL = /asset:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;

export const resolveAssets = (text: string, url: (id: string) => string | undefined) => text.replace(ASSET_URL, (_, id: string) => url(id) ?? '');

// Risu's distance for a name that matches none: models write names from {{assetlist}} and often get one slightly wrong.
const NEAR = 4;
const EXTENSIONS = /\.(webp|png|jpe?g|gif|mp4|webm|avi|m4p|m4v|mp3|wav|ogg)$/;
const bare = (name: string) => name.replace(EXTENSIONS, '').trim().replace(/[\s_.-]/g, '');

// As Risu finds one: the name in any case, one of several that share it by the tag's own roll; else the name nearest
// within NEAR edits, its extension and separators aside.
export function findAsset(assets: readonly BotAsset[], name: string, random: () => number): BotAsset | null {
  const wanted = name.toLowerCase();
  const same = assets.filter((asset) => asset.name.toLowerCase() === wanted);
  if (same.length) return same[Math.floor(random() * same.length)]!;
  const target = bare(wanted);
  let nearest: BotAsset | null = null;
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
