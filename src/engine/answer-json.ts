// A task model's JSON answer, read as given or from inside one code fence, which models add though asked not to.
export function answerJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/.exec(text.trim());
  try {
    return { ok: true, value: JSON.parse(fenced ? fenced[1]! : text.trim()) };
  } catch {
    return { ok: false };
  }
}
