import type { Scene } from '../../model/illustration';

const place = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;

export const moveFigure = (scene: Scene, index: number, x: number, y: number): Scene => ({
  ...scene,
  characters: scene.characters.map((figure, at) => (at === index ? { ...figure, x: place(x), y: place(y) } : figure)),
});

// The Danbooru count tags the writer puts first in setting (engine/illustrate INSTRUCTIONS).
const COUNTS = /^(?:(?:\d+\+?(?:girls?|boys?)|multiple (?:girls|boys)|no humans)(?:\s*,\s*|\s*$))+/i;

const counted = (count: number, word: 'girl' | 'boy') => (count === 0 ? [] : count === 1 ? [`1${word}`] : [`${count >= 6 ? '6+' : count}${word}s`]);

// A figure is a girl or a boy by the first word of its look; any other look is counted as neither.
function countTags(scene: Scene): string[] {
  if (!scene.characters.length) return ['no humans'];
  const first = scene.characters.map(({ look }) => look.trim().split(/[\s,]+/)[0]!.toLowerCase());
  return [...counted(first.filter((word) => word === 'girl').length, 'girl'), ...counted(first.filter((word) => word === 'boy').length, 'boy')];
}

// A setting that does not start with count tags is left as written.
export function removeFigure(scene: Scene, index: number): Scene {
  const removed = { ...scene, characters: scene.characters.filter((_, at) => at !== index) };
  const leading = COUNTS.exec(scene.setting.trimStart());
  if (!leading) return removed;
  const rest = scene.setting.trimStart().slice(leading[0].length);
  return { ...removed, setting: [...countTags(removed), ...(rest ? [rest] : [])].join(', ') };
}
