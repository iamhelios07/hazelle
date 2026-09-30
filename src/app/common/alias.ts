// How the user sees a character or a persona in lists and pickers: its name, then its 별명 when it has one.
export function aliased(name: string, alias: string | undefined): string {
  const note = alias?.trim();
  return note ? `${name} · ${note}` : name;
}
