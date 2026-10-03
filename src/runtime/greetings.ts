import type { ChatScope } from '../engine/render';
import { shown, type Message, type Translation } from '../model/chat';

// Choice ids are the preview identities and random-tag seeds; persistence keeps them and their pre-save translations.
export type Greetings = { choices: { id: string; index: number; text: string; translation?: Translation }[]; selected: number };

export function projectGreetings(texts: string[], ids: string[], picked: number | null, translated?: (text: string) => Translation | undefined): Greetings | null {
  const first = texts.findIndex((text) => text.trim());
  if (first === -1) return null;
  // Editing the card beside an open new chat can remove its selected greeting.
  const selected = picked === null || picked >= texts.length ? first : picked;
  return {
    choices: texts.map((text, index) => {
      const translation = translated?.(text);
      return { id: ids[index]!, index, text, ...(translation && { translation }) };
    }),
    selected,
  };
}

export function greetingPreview(greetings: Greetings | null, at: number): Message | null {
  return greetings && {
    id: greetings.choices[0]!.id,
    role: 'assistant',
    at,
    versions: greetings.choices.map(({ id, index, text, translation }) => ({ id, seed: id, text, receipt: null, edited: false, at, greeting: index, ...(translation && { translation }) })),
    selected: greetings.selected,
  };
}

// A blank remains selectable, but starting on it writes no first message (user, 2026-10-02).
export const startingGreetings = (greetings: Greetings | null): Greetings | null => greetings?.choices[greetings.selected]!.text.trim() ? greetings : null;

export function greetingOf(messages: readonly Message[]): ChatScope['greeting'] {
  const first = messages[0];
  if (first?.role !== 'assistant' || first.versions[0]!.greeting === undefined) return null;
  const version = shown(first);
  if (version.greeting !== undefined && !version.text.trim()) return null;
  return { index: version.greeting ?? null };
}
