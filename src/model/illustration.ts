import type { ModelRef } from '../connectors/assignment';
import type { PictureRequest } from '../connectors/types';
import type { FileRef } from '../vault/files';
import type { Receipt } from './chat';

// 삽화 (design §6.6): pictures drawn for a chat, each tied to the message version it was drawn for. The message text
// and the bot's assets are never touched.

export type Shape = 'portrait' | 'landscape' | 'square';

// Each text field holds Danbooru-style tags, comma separated. x and y: where the figure stands, 0–1 from the top left.
export type Figure = { name: string; look: string; outfit: string; action: string; x: number; y: number };

// paragraph: the one the picture comes after, by its place in paragraphsOf the version's text, from 0. setting holds
// the place, time and light, and the count tags (2girls); framing the shot and the angle.
export type Scene = { paragraph: number; shape: Shape; setting: string; framing: string; characters: Figure[] };

// receipt: the call that wrote the scene, null for a scene the user changed (어떻게 바꿀까요?). model and sent are
// what was drawn with, enough to draw it again; a picture drawn before 2026-10-09 has no steps, scale, rescale or
// sampler, and drew with the model's own. No cost: the image call reports none.
type Tuning = 'steps' | 'scale' | 'rescale' | 'sampler';

export type Illustration = {
  message: string;
  version: string;
  scene: Scene;
  receipt: Receipt | null;
  model: ModelRef;
  sent: Omit<PictureRequest, 'model' | Tuning> & Partial<Pick<PictureRequest, Tuning>>;
  file: FileRef;
  type: string;
  size: number;
  at: number;
};

// Shared by every chat, or a character's own (Character.ownIllustrate). auto: draw after each reply received, off by default since every
// picture costs the image connection's credit. prompt: the 삽화 prompt, absent for the default. model: the image model,
// absent for the first one starred. Absent fields are read through runtime/characters illustrateSwitches.
// spend: draw a picture not known to be free (runtime/illustrate costs) without asking each time.
export type IllustrateSwitches = { auto?: boolean; spend?: boolean; prompt?: string; model?: ModelRef };

// The one rule of what a paragraph is, which the scene writer reads numbered and the chat places pictures by: each
// line of the stored text with words outside its tags, since roleplay prose often breaks paragraphs with a single
// newline. A line of tags alone (a bot's <GT-SEP/>) shows nothing to put a picture after.
const isParagraph = (line: string) => line.replace(/<[^>]*>/g, '').trim() !== '';
export const paragraphsOf = (text: string): string[] => text.split('\n').filter(isParagraph).map((line) => line.trim());

// The paragraph a picture comes after in text as it stands now; null when an edit left fewer paragraphs, and the
// picture goes at the message's end, never after another paragraph.
export const placeOf = (scene: Pick<Scene, 'paragraph'>, text: string): number | null => (scene.paragraph < paragraphsOf(text).length ? scene.paragraph : null);

// Where a picture stands while the chat's display reshapes the text: a mark on its own line after its paragraph, fed
// to the bot's display scripts with the text and swapped for the picture where the story is drawn. A mark the scripts
// dropped puts the picture at the message end. Never stored, sent, searched or copied: withoutMarks takes them out of
// every display text but the one drawn.
const MARK = /\n?(\d+)/g;
export const placeMark = (paragraph: number) => `${paragraph}`;

// paragraphs past the text's end get no mark.
export function withMarks(text: string, paragraphs: ReadonlySet<number>): string {
  let seen = -1;
  return text
    .split('\n')
    .map((line) => (isParagraph(line) && paragraphs.has(++seen) ? `${line}\n${placeMark(seen)}` : line))
    .join('\n');
}

// keep: the one paragraph whose mark stays.
export const withoutMarks = (text: string, keep: number | null = null) => (text.includes('') ? text.replace(MARK, (whole, paragraph: string) => (Number(paragraph) === keep ? whole : '')) : text);
