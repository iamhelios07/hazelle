import { expect, it } from 'vitest';
import type { Figure, Scene } from '../../model/illustration';
import { moveFigure, removeFigure } from './sceneEdit';

const figure = (name: string, look: string): Figure => ({ name, look, outfit: '', action: '', x: 0.5, y: 0.5 });
const scene = (setting: string, ...characters: Figure[]): Scene => ({ paragraph: 0, shape: 'portrait', setting, framing: 'cowboy shot', characters });

it('moves a figure inside the picture, rounded to two places', () => {
  const moved = moveFigure(scene('1girl, 1boy', figure('유나', 'girl'), figure('준', 'boy')), 1, 1.2, 0.33333);
  expect(moved.characters.map(({ x, y }) => [x, y])).toEqual([[0.5, 0.5], [1, 0.33]]);
});

it('rewrites the count tags for the figures left', () => {
  const three = scene('2girls, 1boy, classroom, sunset', figure('유나', 'girl, teen'), figure('미오', 'girl'), figure('준', 'boy'));
  expect([removeFigure(three, 2).setting, removeFigure(three, 0).setting]).toEqual(['2girls, classroom, sunset', '1girl, 1boy, classroom, sunset']);
  expect(removeFigure(scene('1girl', figure('유나', 'girl')), 0).setting).toBe('no humans');
});

it('leaves a setting that does not start with count tags as written', () => {
  const removed = removeFigure(scene('classroom, 2girls', figure('유나', 'girl'), figure('미오', 'girl')), 0);
  expect([removed.setting, removed.characters.map(({ name }) => name)]).toEqual(['classroom, 2girls', ['미오']]);
});
