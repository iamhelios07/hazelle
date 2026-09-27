export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A token count, or null when the provider did not send a usable one.
export function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
