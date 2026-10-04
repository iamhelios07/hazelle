import { THEME, type Reading, type Theme } from '../ui';

export const SIZE = { min: 14, max: 21 };

export const FONT: Record<Reading['font'], string> = { serif: '명조', sans: '고딕' };
export const SPACING: Record<Reading['leading'], string> = { narrow: '좁게', normal: '보통', wide: '넓게' };
export const REPLY: Record<Reading['reply'], string> = { follow: '따라 내려가기', stay: '보낸 자리에 멈추기' };

export const choices = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

const known = <T extends string>(labels: Record<T, string>, value: unknown, otherwise: T) => (typeof value === 'string' && Object.hasOwn(labels, value) ? (value as T) : otherwise);
const flag = (value: unknown, otherwise: boolean) => (typeof value === 'boolean' ? value : otherwise);

function fields<K extends string>(stored: string): Partial<Record<K, unknown>> {
  const parsed: unknown = JSON.parse(stored);
  return typeof parsed === 'object' && parsed !== null ? parsed : {};
}

// Stored on the device, so another version or a hand may have written it: a field that is not one of the choices
// starts from fallback's.
export function parseReading(stored: string, fallback: Reading): Reading {
  const read = fields<keyof Reading>(stored);
  const { size } = read;
  return {
    font: known(FONT, read.font, fallback.font),
    size: typeof size === 'number' && Number.isInteger(size) && size >= SIZE.min && size <= SIZE.max ? size : fallback.size,
    leading: known(SPACING, read.leading, fallback.leading),
    width: known(SPACING, read.width, fallback.width),
    reply: known(REPLY, read.reply, fallback.reply),
  };
}

export type Display = { theme: Theme; hideHeader: boolean; foldComposer: boolean };

export const DISPLAY_DEFAULT: Display = { theme: 'dark', hideHeader: true, foldComposer: true };

export function parseDisplay(stored: string, fallback: Display): Display {
  const read = fields<keyof Display>(stored);
  return {
    theme: known(THEME, read.theme, fallback.theme),
    hideHeader: flag(read.hideHeader, fallback.hideHeader),
    foldComposer: flag(read.foldComposer, fallback.foldComposer),
  };
}

// A preset sets the look only, never 답장이 올 때 or the reading chrome. No preset id is stored: the current preset is
// the one whose every value matches.
export type Look = Pick<Reading, 'font' | 'size' | 'leading' | 'width'> & Pick<Display, 'theme'>;
export type Preset = { name: string; look: Look };

// 기본 takes initial's values, so --prose-size in tokens.css stays the one default size. It stays first: 처음 값으로
// 되돌리기 picks the first.
export function presets(initial: Reading): Preset[] {
  const { font, size, leading, width } = initial;
  return [
    { name: '기본', look: { theme: 'dark', font, size, leading, width } },
    { name: '밝은 서재', look: { theme: 'light', font: 'serif', size, leading, width } },
    { name: '고딕 간결', look: { theme: 'dark', font: 'sans', size: 15, leading: 'narrow', width: 'narrow' } },
    { name: '넓게 읽기', look: { theme: 'dark', font: 'serif', size: 18, leading: 'wide', width: 'wide' } },
  ];
}

export const presetOf = (list: Preset[], reading: Reading, display: Display): Preset | undefined =>
  list.find(({ look }) => look.theme === display.theme && look.font === reading.font && look.size === reading.size && look.leading === reading.leading && look.width === reading.width);

export const describeLook = ({ theme, font, size, leading, width }: Look) => `${THEME[theme]} · ${FONT[font]} ${size} · 줄 간격 ${SPACING[leading]} · 읽기 폭 ${SPACING[width]}`;
