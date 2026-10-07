export function without<T extends object>(from: T, key: keyof T): T {
  const rest = { ...from };
  delete rest[key];
  return rest;
}
