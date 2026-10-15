import { isRecord } from '../../connectors/values';
import { text } from './convert';
import { base64 } from './png';
import type { ImportResult } from './types';

// Risu's importUserPersona takes a persona only with a name and a prompt. Its note is read as a backup's (engine/import/backup).
export function readPersona(payload: string, image: Uint8Array<ArrayBuffer>): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(base64(payload)));
  } catch {
    return { ok: false, failure: { kind: 'unreadable', detail: 'persona-unreadable' } };
  }
  if (!isRecord(raw)) return { ok: false, failure: { kind: 'unreadable', detail: 'persona-unreadable' } };
  const name = text(raw.name);
  const description = text(raw.personaPrompt);
  if (!name || !description) return { ok: false, failure: { kind: 'unreadable', detail: 'persona-incomplete' } };
  return { ok: true, persona: { name, alias: text(raw.note).trim(), description, picture: async () => ({ bytes: image, type: 'image/png' }) } };
}
