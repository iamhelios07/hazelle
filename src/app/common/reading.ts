import type { SavedLook } from '../../model/settings';
import { ACCENT, BG, DIALOGUE, INK, THEME, type Reading, type Scheme } from '../ui';

export const SIZE = { min: 14, max: 21 };

export const FONT: Record<Reading['font'], string> = { serif: '명조', sans: '고딕' };
export const SPACING: Record<Reading['leading'], string> = { narrow: '좁게', normal: '보통', wide: '넓게' };
export const REPLY: Record<Reading['reply'], string> = { follow: '자동 스크롤', stay: '스크롤 고정' };

export const choices = <T extends string>(labels: Record<T, string>) => (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

const named = <T extends string>(labels: Record<T, string>, value: unknown) => (typeof value === 'string' && Object.hasOwn(labels, value) ? (value as T) : undefined);
const known = <T extends string>(labels: Record<T, string>, value: unknown, otherwise: T) => named(labels, value) ?? otherwise;
const sized = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= SIZE.min && value <= SIZE.max ? value : undefined);
const flag = (value: unknown, otherwise: boolean) => (typeof value === 'boolean' ? value : otherwise);

function fields<K extends string>(stored: string): Partial<Record<K, unknown>> {
  const parsed: unknown = JSON.parse(stored);
  return typeof parsed === 'object' && parsed !== null ? parsed : {};
}

// Stored on the device, so another version or a hand may have written it: a field that is not one of the choices
// starts from fallback's.
export function parseReading(stored: string, fallback: Reading): Reading {
  const read = fields<keyof Reading>(stored);
  return {
    font: known(FONT, read.font, fallback.font),
    size: sized(read.size) ?? fallback.size,
    leading: known(SPACING, read.leading, fallback.leading),
    width: known(SPACING, read.width, fallback.width),
    reply: known(REPLY, read.reply, fallback.reply),
  };
}

export type Display = Scheme & { hideHeader: boolean; foldComposer: boolean; hidePictures: boolean };

const PLAIN = { bg: 'base', ink: 'base', accent: 'base', dialogue: 'base' } as const;

export const DISPLAY_DEFAULT: Display = { theme: 'dark', ...PLAIN, hideHeader: true, foldComposer: true, hidePictures: false };

export function parseDisplay(stored: string, fallback: Display): Display {
  const read = fields<keyof Display>(stored);
  return {
    theme: known(THEME, read.theme, fallback.theme),
    bg: known(BG, read.bg, fallback.bg),
    ink: known(INK, read.ink, fallback.ink),
    accent: known(ACCENT, read.accent, fallback.accent),
    dialogue: known(DIALOGUE, read.dialogue, fallback.dialogue),
    hideHeader: flag(read.hideHeader, fallback.hideHeader),
    foldComposer: flag(read.foldComposer, fallback.foldComposer),
    hidePictures: flag(read.hidePictures, fallback.hidePictures),
  };
}

// A preset sets the look only, never 응답이 올 때 or the reading chrome. No preset id is stored: the current preset is
// the one whose every value matches.
export type Look = Pick<Reading, 'font' | 'size' | 'leading' | 'width'> & Scheme;
export type Preset = { name: string; look: Look };
export type OwnPreset = Preset & { id: string };

// 기본 takes initial's values, so --prose-size in tokens.css stays the one default size. It stays first: 기본값으로
// 되돌리기 picks the first.
export function presets(initial: Reading): Preset[] {
  const { font, size, leading, width } = initial;
  return [
    { name: '기본', look: { theme: 'dark', ...PLAIN, font, size, leading, width } },
    { name: '밝은 서재', look: { theme: 'light', ...PLAIN, font: 'serif', size, leading, width } },
    { name: '고딕 간결', look: { theme: 'dark', ...PLAIN, font: 'sans', size: 15, leading: 'narrow', width: 'narrow' } },
    { name: '넓게 읽기', look: { theme: 'dark', ...PLAIN, font: 'serif', size: 18, leading: 'wide', width: 'wide' } },
    { name: '밤바다', look: { theme: 'dark', ...PLAIN, bg: 'blue', accent: 'blue', dialogue: 'sky', font, size, leading, width } },
    { name: '숲', look: { theme: 'dark', ...PLAIN, bg: 'green', accent: 'green', dialogue: 'lime', font, size, leading, width } },
    { name: '세피아', look: { theme: 'light', ...PLAIN, bg: 'brown', font: 'serif', size, leading: 'wide', width } },
  ];
}

export const lookOf = ({ font, size, leading, width }: Reading, { theme, bg, ink, accent, dialogue }: Display): Look => ({ theme, bg, ink, accent, dialogue, font, size, leading, width });

const LOOK: Record<keyof Look, true> = { theme: true, bg: true, ink: true, accent: true, dialogue: true, font: true, size: true, leading: true, width: true };
const LOOK_KEYS = Object.keys(LOOK) as (keyof Look)[];

export function presetOf(list: Preset[], reading: Reading, display: Display): Preset | undefined {
  const now = lookOf(reading, display);
  return list.find(({ look }) => LOOK_KEYS.every((key) => look[key] === now[key]));
}

export function describeLook({ theme, bg, ink, accent, dialogue, font, size, leading, width }: Look) {
  const picks = [bg !== 'base' && `배경 ${BG[bg]}`, ink !== 'base' && `글자 ${INK[ink]}`, dialogue !== 'base' && `대사 ${DIALOGUE[dialogue]}`, accent !== 'base' && `강조 ${ACCENT[accent]}`].filter(Boolean);
  return [THEME[theme], ...picks, `${FONT[font]} ${size}`, `줄 간격 ${SPACING[leading]}`, `읽기 폭 ${SPACING[width]}`].join(' · ');
}

// Written by this app, but another version may know a value this one does not: such a preset is counted as unread,
// never shown with a value it did not save.
export function savedPresets(looks: SavedLook[] = []): { presets: OwnPreset[]; unread: number } {
  const presets = looks.flatMap(({ id, name, look }) => {
    const read = parseLook(look);
    return read && typeof id === 'string' ? [{ id, name, look: read }] : [];
  });
  return { presets, unread: looks.length - presets.length };
}

function parseLook(look: SavedLook['look']): Look | null {
  const read = {
    theme: named(THEME, look.theme),
    bg: named(BG, look.bg),
    ink: named(INK, look.ink),
    accent: named(ACCENT, look.accent),
    // Looks saved by v0.1.73 predate 대사.
    dialogue: look.dialogue === undefined ? 'base' : named(DIALOGUE, look.dialogue),
    font: named(FONT, look.font),
    size: sized(look.size),
    leading: named(SPACING, look.leading),
    width: named(SPACING, look.width),
  };
  return LOOK_KEYS.every((key) => read[key] !== undefined) ? (read as Look) : null;
}

// The look ends where target was, before it when moved toward the front and after it when moved toward the back; an
// unread look keeps its place among the rest.
export function moveLook(looks: SavedLook[], id: string, target: string): SavedLook[] {
  const from = looks.findIndex((look) => look.id === id);
  const to = looks.findIndex((look) => look.id === target);
  if (from < 0 || to < 0 || from === to) return looks;
  return looks.toSpliced(from, 1).toSpliced(to, 0, looks[from]!);
}
