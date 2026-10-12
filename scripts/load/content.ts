import { createCipheriv, createHash } from 'node:crypto';

// Everything the harness writes is derived from the seed, so a run with the same options writes the same bytes.

export type Range = [min: number, max: number];

export type Shape = {
  seed: string;
  textMb: Range;
  bigShare: number;
  bigTextMb: Range;
  pictureMb: Range;
  pictureKb: Range;
  shared: number;
  sharedPool: number;
};

export type Plan = { textBytes: number; pictureBytes: number };

export function keystream(label: string, bytes: number): Buffer {
  const key = createHash('sha256').update(label).digest();
  return createCipheriv('aes-256-ctr', key, Buffer.alloc(16)).update(Buffer.alloc(bytes));
}

// A uniform stream of [0, 1) for one label.
export function random(label: string): () => number {
  let block = 0;
  let words: Uint32Array = new Uint32Array(0);
  let at = 0;
  return () => {
    if (at === words.length) {
      const bytes = keystream(`${label}:${block++}`, 4096);
      words = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
      at = 0;
    }
    return words[at++]! / 2 ** 32;
  };
}

const between = (next: () => number, [min, max]: Range) => min + next() * (max - min);
const MB = 1024 * 1024;

export function planAccounts(shape: Shape, count: number): Plan[] {
  const next = random(`${shape.seed}:plans`);
  const bigCount = Math.round(count * shape.bigShare);
  // Spread through the list, so a run's first accounts are not all small.
  const big = new Set(Array.from({ length: bigCount }, (_, k) => Math.floor((k * count) / bigCount)));
  return Array.from({ length: count }, (_, index) => ({
    textBytes: Math.round(between(next, big.has(index) ? shape.bigTextMb : shape.textMb) * MB),
    pictureBytes: Math.round(between(next, shape.pictureMb) * MB),
  }));
}

// A sealed body as the client stores it: base64 of ciphertext.
export function* objectBodies(label: string, total: number): Generator<string> {
  const next = random(`${label}:sizes`);
  let written = 0;
  for (let index = 0; written < total; index++) {
    const roll = next();
    const plain = roll < 0.9 ? between(next, [1_000, 8_000]) : roll < 0.99 ? between(next, [8_000, 64_000]) : between(next, [64_000, 1_000_000]);
    const body = keystream(`${label}:${index}`, Math.ceil(plain * 0.75)).toString('base64');
    written += body.length;
    yield body;
  }
}

// Sizes are log-uniform over pictureKb. A shared picture's bytes depend only on its pool index, so every account
// drawing it uploads the same content.
export function* pictures(shape: Shape, label: string, total: number): Generator<Buffer> {
  const next = random(`${label}:pictures`);
  const seen = new Set<number>();
  const size = (draw: () => number) => Math.round(Math.exp(between(draw, [Math.log(shape.pictureKb[0]), Math.log(shape.pictureKb[1])])) * 1024);
  let written = 0;
  for (let index = 0; written < total; index++) {
    let bytes: Buffer;
    if (next() < shape.shared) {
      const pick = Math.floor(next() * shape.sharedPool);
      if (seen.has(pick)) continue;
      seen.add(pick);
      bytes = keystream(`${shape.seed}:shared:${pick}`, size(random(`${shape.seed}:shared-size:${pick}`)));
    } else {
      bytes = keystream(`${label}:own:${index}`, size(next));
    }
    written += bytes.length;
    yield bytes;
  }
}
