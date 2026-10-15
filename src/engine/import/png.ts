const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const TEXT_KEYS = new Set(['chara', 'ccv3', 'persona']);
const ASSET = 'chara-ext-asset_';
const decoder = new TextDecoder();

// The same one-liner as vault/aead.ts, which the engine may not import.
export const base64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

export type Png = {
  // The card's base64 payload. ccv3 wins over chara.
  card: string | null;
  // A Risu persona's base64 payload (Risu's exportUserPersona); a card chunk beside it wins.
  persona: string | null;
  // The file without the card's or persona's tEXt chunks, ending at IEND: the stored picture is the image alone.
  image: Uint8Array<ArrayBuffer>;
  // The base64 files a card names `__asset:N`, by N: Risu writes each in a chunk `chara-ext-asset_:N` (older
  // cards: `chara-ext-asset_N`).
  assets: Map<string, string>;
};

// Only tEXt chunks carry a card; iTXt and zTXt are image metadata and stay in the image.
export function readPng(bytes: Uint8Array): Png | null {
  if (bytes.length < SIGNATURE.length || SIGNATURE.some((byte, i) => bytes[i] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new Map<string, string>();
  const assets = new Map<string, string>();
  const kept = [bytes.subarray(0, SIGNATURE.length)];
  let pos = SIGNATURE.length;
  while (pos + 12 <= bytes.length) {
    const end = pos + 12 + view.getUint32(pos);
    if (end > bytes.length) return null;
    const type = String.fromCharCode(...bytes.subarray(pos + 4, pos + 8));
    const chunk = bytes.subarray(pos, end);
    pos = end;
    if (type === 'tEXt') {
      const data = chunk.subarray(8, -4);
      const nul = data.indexOf(0);
      const key = nul === -1 ? '' : decoder.decode(data.subarray(0, nul));
      if (TEXT_KEYS.has(key)) {
        text.set(key, decoder.decode(data.subarray(nul + 1)));
        continue;
      }
      if (key.startsWith(ASSET)) {
        assets.set(key.slice(ASSET.length).replace(/^:/, ''), decoder.decode(data.subarray(nul + 1)));
        continue;
      }
    }
    kept.push(chunk);
    if (type === 'IEND') return { card: text.get('ccv3') || text.get('chara') || null, persona: text.get('persona') ?? null, image: concat(kept), assets };
  }
  return null;
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
