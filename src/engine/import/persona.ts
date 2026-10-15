import { isRecord } from '../../connectors/values';
import { text } from './convert';
import { base64 } from './png';
import type { ImportResult } from './types';

// A Risu persona record, from a backup's list or a persona PNG.
export const risuPersonaFields = (raw: Record<string, unknown>) => ({ name: text(raw.name), alias: text(raw.note).trim(), description: text(raw.personaPrompt) });

// Risu's importUserPersona takes a persona only with a name and a prompt.
export function readPersona(payload: string, image: Uint8Array<ArrayBuffer>): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(base64(payload)));
  } catch {
    return { ok: false, failure: { kind: 'unreadable', detail: 'persona-unreadable' } };
  }
  if (!isRecord(raw)) return { ok: false, failure: { kind: 'unreadable', detail: 'persona-unreadable' } };
  const fields = risuPersonaFields(raw);
  if (!fields.name || !fields.description) return { ok: false, failure: { kind: 'unreadable', detail: 'persona-incomplete' } };
  return { ok: true, persona: { ...fields, picture: async () => ({ bytes: image, type: 'image/png' }) } };
}
