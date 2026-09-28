// The longest side of the thumbnail that lists and 캐릭터 둘러보기 show; the original stays in its blob.
const THUMB = 400;

// A small copy of the picture for lists. Safari cannot write WebP and hands back PNG, which is far
// larger, so it gets JPEG instead.
export async function thumbnail({ bytes, type }: { bytes: Uint8Array<ArrayBuffer>; type: string }): Promise<string> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type }));
  const scale = Math.min(1, THUMB / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
  if (blob.type !== 'image/webp') blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
