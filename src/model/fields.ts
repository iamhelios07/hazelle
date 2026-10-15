export function without<T extends object>(from: T, key: keyof T): T {
  const rest = { ...from };
  delete rest[key];
  return rest;
}

export function moved<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
