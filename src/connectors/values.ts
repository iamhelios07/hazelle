export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function amount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

type Entry = Record<string, unknown> & { id: string };

// null when the payload is not a model list at all, which is not the same as an empty one.
export function modelEntries(payload: unknown): Entry[] | null {
  if (!isRecord(payload) || !Array.isArray(payload.data)) return null;
  return payload.data.filter((raw): raw is Entry => isRecord(raw) && typeof raw.id === 'string' && raw.id !== '');
}

export function nameOf(raw: Entry, field: string): string {
  const name = raw[field];
  return typeof name === 'string' && name ? name : raw.id;
}
