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
// what was drawn with, enough to draw it again. No cost: the image call reports none.
export type Illustration = {
  message: string;
  version: string;
  scene: Scene;
  receipt: Receipt | null;
  model: ModelRef;
  sent: Omit<PictureRequest, 'model'>;
  file: FileRef;
  type: string;
  size: number;
  at: number;
};

// The one rule of what a paragraph is, which the scene writer reads numbered and the chat places pictures by: each
// non-blank line of the stored text, since roleplay prose often breaks paragraphs with a single newline.
export const paragraphsOf = (text: string): string[] => text.split('\n').map((line) => line.trim()).filter((line) => line !== '');

// The paragraph a picture comes after in text as it stands now; null when an edit left fewer paragraphs, and the
// picture goes at the message's end, never after another paragraph.
export const placeOf = (scene: Pick<Scene, 'paragraph'>, text: string): number | null => (scene.paragraph < paragraphsOf(text).length ? scene.paragraph : null);
