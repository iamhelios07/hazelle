import { pictureRef, resolveAssets, type PictureKind, type PictureUrl } from '../../engine/assets';
import type { Display } from '../../engine/display';
import { shown } from '../../model/chat';
import { placeMark, withMarks, withoutMarks } from '../../model/illustration';
import type { Stored } from '../../model/kinds';
import type { Shown } from '../../runtime/talk';
import { inlaid, type LogRow } from '../ui';
import { shownHtml, speaker } from './ChatMessage';
import type { speakers } from './ChatLog';
import { seenText } from './search';

export type LogText = 'translation' | 'original' | 'both';
// from, to: message numbers, from 1, both included.
export type LogChoices = { pictures: boolean; hideMe: boolean; text: LogText; from: number; to: number };
// pictures: by pictureRef.
export type LogDraft = { rows: LogRow[]; css: string; pictures: Map<string, { kind: PictureKind; id: string }> };

const ME_HIDDEN = '나';

const unlogged = (message: Shown) => message.live !== null || shown(message).receipt?.state === 'failed';

// What a translated log would show untranslated in the range: the messages it holds with a text and no translation.
export const untranslated = (messages: Shown[], view: Display, { from, to }: Pick<LogChoices, 'from' | 'to'>) =>
  messages.slice(from - 1, to).filter((message, offset) => !unlogged(message) && !shown(message).translation && view.texts[from - 1 + offset]!.trim());

// The pictures the chat shows besides its display: by index, the shown text with its 삽화 marks, and by version its 삽화,
// oldest first (useChat).
export type Illustrated = { placed: ReadonlyMap<number, string>; pictures: ReadonlyMap<string, Stored<'illustration'>[]> };

// The rows a log draws, as the chat draws them, their pictures still named by pictureRef. A reply being written, a
// failed one and an empty one are left out, and a message's boxes stand in it as they did when it was written. A
// message's newest 삽화 goes into its first text, at its paragraph as the chat places it.
export function logDraft(messages: Shown[], view: Display, { placed, pictures: drawn }: Illustrated, flipped: ReadonlySet<string>, bot: boolean, names: ReturnType<typeof speakers>, { hideMe, text, from, to }: LogChoices): LogDraft {
  const decor = { bot, url: pictureRef };
  const rows: LogRow[] = [];
  for (let index = Math.max(from, 1) - 1; index < Math.min(to, messages.length); index++) {
    const message = messages[index]!;
    const version = shown(message);
    if (unlogged(message)) continue;
    const original = view.texts[index]!;
    const translation = version.translation?.text ?? null;
    const own = { text: original, original: true };
    const other = translation === null ? own : { text: translation, original: false };
    const said = (text === 'original' ? [own] : text === 'both' ? [...new Set([own, other])] : [seenText(original, translation, null, flipped.has(version.id)) === original ? own : other]).filter((each) => each.text.trim());
    const picture = drawn.get(version.id)?.at(-1);
    const story = ({ text, original }: (typeof said)[number], at: number) => {
      if (!picture || at > 0) return shownHtml(text, decor);
      const { paragraph } = picture.value.scene;
      const marked = original ? withoutMarks(placed.get(index) ?? text, paragraph) : withMarks(text, new Set([paragraph]));
      return inlaid(shownHtml(marked, decor), placeMark(paragraph), `<img src="${pictureRef('illustration', picture.id)}">`);
    };
    const boxes = view.boxes[index]!;
    if (!said.length && !boxes.length) continue;
    const box = ({ html }: (typeof boxes)[number]) => shownHtml(html, decor);
    const stories = [...boxes.filter(({ at }) => at === 'top').map(box), ...said.map(story), ...boxes.filter(({ at }) => at === 'bottom').map(box)];
    const mine = message.role === 'user';
    rows.push({ key: message.id, name: mine && hideMe ? ME_HIDDEN : speaker(message, names.character, names.me, names.modelName), mine, stories });
  }
  const css = bot ? view.css : '';
  const pictures: LogDraft['pictures'] = new Map();
  const collect = (kind: PictureKind, id: string) => void pictures.set(pictureRef(kind, id), { kind, id });
  for (const source of [css, ...rows.flatMap(({ stories }) => stories)]) resolveAssets(source, collect);
  return { rows, css, pictures };
}

// url: a picture's source; undefined leaves it out.
export const resolveLog = ({ rows, css }: LogDraft, url: PictureUrl) => ({
  rows: rows.map((row) => ({ ...row, stories: row.stories.map((story) => resolveAssets(story, url)) })),
  css: resolveAssets(css, url),
});
