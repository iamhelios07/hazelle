import { expect, it } from 'vitest';
import { describeUnused } from './unused';

it('names what chats do not use', () => {
  expect(describeUnused([{ kind: 'bias', count: 142 }])).toBe('바이어스 142개는 대화에 적용되지 않아요.');
  expect(describeUnused([])).toBeNull();
});
