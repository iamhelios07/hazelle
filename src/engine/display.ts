import MarkdownIt, { type StateCore, type Token } from 'markdown-it';
import { unescapeCbs } from './cbs/escape';
import { evaluate } from './cbs/evaluate';
import { contexts, renderChat, type ChatScope } from './render';

// texts: each message's text as shown, its <style> blocks taken out. css: what those blocks and the card's
// backgroundHTML carry. As in Risu, it applies to every message of the chat, not only the one that carried it.
export type Display = { texts: string[]; css: string };

const STYLE = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi;

export function display(scope: ChatScope): Display {
  const { texts, variables } = renderChat('display', scope);
  const blocks: string[] = [];
  const take = (text: string) =>
    text.replace(STYLE, (_, css: string) => {
      blocks.push(css);
      return '';
    });
  // Read with the variables as the last message left them, as Risu reads it with the chat's current ones.
  if (scope.card?.background) take(unescapeCbs(evaluate(scope.card.background, contexts(scope, 'display', null)({ seed: 'background' }, variables))));
  const shown = texts.map(take);
  return { texts: shown, css: [...new Set(blocks.map((block) => block.trim()))].join('\n') };
}

// Markdown as Risu parses it (markdown-it, soft breaks kept, no indented code), so a bot's HTML blocks and the prose
// between them split where they did there. The prose is the app's: each line its own paragraph, and its marks read
// by `marks` rather than markdown's emphasis, which misses Korean text such as *끄덕였다.*그리고.
function parser(html: boolean) {
  const md = new MarkdownIt({ html, breaks: true, linkify: false, typographer: false });
  md.disable(['code', 'emphasis']);
  // Before text_join, so an escaped \* is still its own token and not read as a mark.
  md.core.ruler.before('text_join', 'story_lines', lines);
  md.core.ruler.after('story_lines', 'story_marks', marks);
  return md;
}
const BOT = parser(true);
const PLAIN = parser(false);

// A message's shown text as the story's HTML. bot: the bot's HTML is kept, for the sanitizer to take what it
// allows; without it, tags show as text.
export const storyHtml = (text: string, bot: boolean) => (bot ? BOT : PLAIN).render(text);

// A paragraph of several lines becomes one paragraph per line. A tight list's hidden paragraphs keep their breaks.
function lines(state: StateCore) {
  const out: Token[] = [];
  state.tokens.forEach((token, index) => {
    const open = state.tokens[index - 1]!;
    if (token.type !== 'inline' || open.type !== 'paragraph_open' || open.hidden) return void out.push(token);
    const groups: Token[][] = [[]];
    for (const child of token.children!) {
      if (child.type === 'softbreak') groups.push([]);
      else groups.at(-1)!.push(child);
    }
    groups.forEach((children, at) => {
      if (at > 0) out.push(Object.assign(new state.Token('paragraph_close', 'p', -1), { block: true }), Object.assign(new state.Token('paragraph_open', 'p', 1), { block: true }));
      out.push(Object.assign(new state.Token('inline', '', 0), { children }));
    });
  });
  state.tokens = out;
}

type Mark = '**' | '*' | '"' | '“';
const MARK = /\*\*|\*|"|“|”/g;
const TAGS: Record<Mark, { type: string; tag: string }> = { '**': { type: 'strong', tag: 'strong' }, '*': { type: 'em', tag: 'em' }, '"': { type: 'mark', tag: 'mark' }, '“': { type: 'mark', tag: 'mark' } };

// *Actions* lose their asterisks and **bold** its pairs; “dialogue” and "dialogue" keep their quotes, in the mark Risu
// gives them, so a bot's CSS for dialogue applies. A mark left open runs to the end of its line, which is how a reply
// looks while it streams.
function marks(state: StateCore) {
  for (const token of state.tokens) {
    if (token.type !== 'inline') continue;
    const out: Token[] = [];
    const open: Mark[] = [];
    const tag = (mark: Mark, nesting: 1 | -1) => {
      const { type, tag } = TAGS[mark];
      const token = new state.Token(nesting === 1 ? `${type}_open` : `${type}_close`, tag, nesting);
      if (nesting === 1 && type === 'mark') token.attrSet('risu-mark', 'quote2');
      out.push(token);
    };
    const text = (content: string) => content && out.push(Object.assign(new state.Token('text', '', 0), { content }));
    const close = (from: number) => {
      const above = open.splice(from);
      for (const mark of above.toReversed()) tag(mark, -1);
      return above.slice(1);
    };
    for (const child of token.children!) {
      if (child.type === 'softbreak' || child.type === 'hardbreak') close(0);
      if (child.type !== 'text') {
        out.push(child);
        continue;
      }
      let last = 0;
      for (const match of child.content.matchAll(MARK)) {
        text(child.content.slice(last, match.index));
        last = match.index + match[0].length;
        const found = match[0] === '”' ? '“' : (match[0] as Mark);
        const at = match[0] === '“' ? -1 : open.lastIndexOf(found);
        if (at === -1 && match[0] === '”') {
          text(match[0]);
        } else if (at === -1) {
          open.push(found);
          tag(found, 1);
          if (found === '"' || found === '“') text(match[0]);
        } else {
          if (found === '"' || found === '“') text(match[0]);
          // Closing a mark that another opened inside of closes that one too, and opens it again after.
          for (const mark of close(at)) {
            open.push(mark);
            tag(mark, 1);
          }
        }
      }
      text(child.content.slice(last));
    }
    close(0);
    token.children = out;
  }
}
