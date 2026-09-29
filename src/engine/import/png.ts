const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const CARD_KEYS = new Set(['chara', 'ccv3']);
const decoder = new TextDecoder();

export type Png = {
  // The card's base64 payload. ccv3 wins over chara.
  card: string | null;
  // The file without the card's tEXt chunks, ending at IEND: the stored avatar is the image alone.
  image: Uint8Array<ArrayBuffer>;
};

// Only tEXt chunks carry a card; iTXt and zTXt are image metadata and stay in the image.
export function readPng(bytes: Uint8Array): Png | null {
  if (bytes.length < SIGNATURE.length || SIGNATURE.some((byte, i) => bytes[i] !== byte)) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = new Map<string, string>();
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
      if (CARD_KEYS.has(key)) {
        text.set(key, decoder.decode(data.subarray(nul + 1)));
        continue;
      }
      if (key.startsWith('chara-ext-asset_')) continue;
    }
    kept.push(chunk);
    if (type === 'IEND') return { card: text.get('ccv3') || text.get('chara') || null, image: concat(kept) };
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
