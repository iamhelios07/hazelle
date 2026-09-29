import type { Persona } from '../../model/persona';

// How the user sees a persona in lists and pickers: its name, then its 별명 when it has one.
export function personaTitle({ name, nickname }: Persona): string {
  const note = nickname?.trim();
  return note ? `${name} · ${note}` : name;
}
