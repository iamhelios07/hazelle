import type { InputPicture } from '../connectors/types';
import { fromBase64, toBase64 } from '../vault/aead';

const THUMB = 400;
// The longest side of a picture shown to a model: enough to read a character's looks, a few hundred tokens each.
const SHOWN = 768;

// Safari cannot write WebP and hands back PNG, which is far larger, so it gets JPEG instead.
async function shrink({ bytes, type }: { bytes: Uint8Array<ArrayBuffer>; type: string }, longest: number): Promise<Blob> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type }));
  const scale = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
  return blob.type === 'image/webp' ? blob : canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

export async function thumbnail(picture: { bytes: Uint8Array<ArrayBuffer>; type: string }): Promise<string> {
  const blob = await shrink(picture, THUMB);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// A thumbnail, which shrink writes as WebP or JPEG, redrawn as a PNG; none is a grey 256×256 square, as Risu's persona
// file holds then.
export async function pngOf(thumb: string | null): Promise<Uint8Array<ArrayBuffer>> {
  let canvas: OffscreenCanvas;
  if (thumb === null) {
    canvas = new OffscreenCanvas(256, 256);
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'grey';
    context.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    const type = thumb.slice('data:'.length, thumb.indexOf(';'));
    const bitmap = await createImageBitmap(new Blob([fromBase64(thumb.slice(thumb.indexOf(',') + 1))], { type }));
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
  }
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

// type: what the canvas wrote, not the stored picture's.
export async function shownPicture(picture: { bytes: Uint8Array<ArrayBuffer>; type: string }): Promise<InputPicture> {
  const blob = await shrink(picture, SHOWN);
  return { type: blob.type, data: toBase64(new Uint8Array(await blob.arrayBuffer())) };
}
