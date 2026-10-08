// A message's picture (삽화) in its story HTML: where the one mark the caller kept stands, as a paragraph of its own or
// inside the bot's HTML, or at the end when the bot's scripts dropped the mark or copied it; never after another
// paragraph.
export function inlaid(html: string, mark: string, inlay: string): string {
  const alone = `<p>${mark}</p>`;
  if (html.split(mark).length === 2) return html.includes(alone) ? html.replace(alone, () => `<p>${inlay}</p>`) : html.replace(mark, () => inlay);
  return `${html.replaceAll(alone, '').replaceAll(mark, '')}<p>${inlay}</p>`;
}
