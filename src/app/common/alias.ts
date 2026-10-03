export function aliased(name: string, alias: string | undefined): string {
  const note = alias?.trim();
  return note ? `${name} · ${note}` : name;
}
