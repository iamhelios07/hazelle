import type { Reading } from '../ui';

// design F3: the text size steps between these.
export const SIZE = { min: 14, max: 21 };

export const FONT: Record<Reading['font'], string> = { serif: '명조', sans: '고딕' };
export const SPACING: Record<Reading['leading'], string> = { narrow: '좁게', normal: '보통', wide: '넓게' };

export const choices = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

const known = <T extends string>(labels: Record<T, string>, value: unknown, otherwise: T) => (typeof value === 'string' && Object.hasOwn(labels, value) ? (value as T) : otherwise);

// Stored on the device, so another version or a hand may have written it: a field that is not one of the choices
// starts from fallback's.
export function parseReading(stored: string, fallback: Reading): Reading {
  const parsed: unknown = JSON.parse(stored);
  const read: Partial<Record<keyof Reading, unknown>> = typeof parsed === 'object' && parsed !== null ? parsed : {};
  const { size } = read;
  return {
    font: known(FONT, read.font, fallback.font),
    size: typeof size === 'number' && Number.isInteger(size) && size >= SIZE.min && size <= SIZE.max ? size : fallback.size,
    leading: known(SPACING, read.leading, fallback.leading),
    width: known(SPACING, read.width, fallback.width),
  };
}
