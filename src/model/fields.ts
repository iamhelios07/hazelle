export function without<T extends object>(from: T, key: keyof T): T {
  const rest = { ...from };
  delete rest[key];
  return rest;
}

// to counts in the list without the items moved.
export function moved<T>(items: readonly T[], from: number, to: number, count = 1): T[] {
  const next = [...items];
  next.splice(to, 0, ...next.splice(from, count));
  return next;
}
