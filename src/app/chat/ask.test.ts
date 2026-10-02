import { expect, it } from 'vitest';
import { asking } from './ask';

const values = (question: Parameters<typeof asking>[0]) => {
  const { answer } = asking(question);
  return answer.kind === 'choices' ? answer.choices.map(({ value }) => value) : answer.kind;
};

it("answers each kind of a bot's question in the values its script reads", () => {
  expect(values({ kind: 'input', text: '이름은?' })).toBe('line');
  expect(values({ kind: 'confirm', text: '갈까?' })).toEqual(['yes', null]);
  expect(values({ kind: 'select', options: ['검', '활', '지팡이'] })).toEqual(['0', '1', '2']);
  expect(values({ kind: 'model' })).toEqual(['yes', 'no']);
});
