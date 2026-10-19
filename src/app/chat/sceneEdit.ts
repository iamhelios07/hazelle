import { recounted } from '../../engine/illustrate';
import type { Scene } from '../../model/illustration';

const place = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;

export const moveFigure = (scene: Scene, index: number, x: number, y: number): Scene => ({
  ...scene,
  characters: scene.characters.map((figure, at) => (at === index ? { ...figure, x: place(x), y: place(y) } : figure)),
});

export const removeFigure = (scene: Scene, index: number): Scene => recounted({ ...scene, characters: scene.characters.filter((_, at) => at !== index) });
