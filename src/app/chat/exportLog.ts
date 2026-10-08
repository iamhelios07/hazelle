import { pictureRef, resolveAssets, type PictureKind, type PictureUrl } from '../../engine/assets';
import type { Display } from '../../engine/display';
import { shown } from '../../model/chat';
import type { Shown } from '../../runtime/talk';
import type { LogRow } from '../ui';
import { shownHtml, speaker } from './ChatMessage';
import type { speakers } from './ChatLog';
import { seenText } from './search';

export type LogText = 'translation' | 'original' | 'both';
// from, to: message numbers, from 1, both included.
export type LogChoices = { pictures: boolean; hideMe: boolean; text: LogText; from: number; to: number };
// pictures: by pictureRef.
export type LogDraft = { rows: LogRow[]; css: string; pictures: Map<string, { kind: PictureKind; id: string }> };

const ME_HIDDEN = '나';

// The rows a log draws, as the chat draws them, their pictures still named by asset: id. A reply being written, a
// failed one and an empty one are left out, and a message's boxes stand in it as they did when it was written.
export function logDraft(messages: Shown[], view: Display, flipped: ReadonlySet<string>, bot: boolean, names: ReturnType<typeof speakers>, { hideMe, text, from, to }: LogChoices): LogDraft {
  const decor = { bot, url: pictureRef };
  const rows: LogRow[] = [];
  for (let index = Math.max(from, 1) - 1; index < Math.min(to, messages.length); index++) {
    const message = messages[index]!;
    const version = shown(message);
    if (message.live !== null || version.receipt?.state === 'failed') continue;
    const original = view.texts[index]!;
    const translation = version.translation?.text ?? null;
    const said = (text === 'original' ? [original] : text === 'both' && translation !== null ? [original, translation] : [seenText(original, translation, null, flipped.has(version.id))]).filter((each) => each.trim());
    const boxes = view.boxes[index]!;
    if (!said.length && !boxes.length) continue;
    const stories = [...boxes.filter(({ at }) => at === 'top').map(({ html }) => html), ...said, ...boxes.filter(({ at }) => at === 'bottom').map(({ html }) => html)];
    const mine = message.role === 'user';
    rows.push({ key: message.id, name: mine && hideMe ? ME_HIDDEN : speaker(message, names.character, names.me, names.modelName), mine, stories: stories.map((html) => shownHtml(html, decor)) });
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
