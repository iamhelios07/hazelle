import { expect, it } from 'vitest';
import { stepAt, TUTORIALS, type Facts } from './tutorial';

it('reads the step from the state: done steps skipped, a step left resumed, the end at the chat screen', () => {
  const [tutorial] = TUTORIALS;
  const facts = (more: Partial<Facts>): Facts => ({ route: { kind: 'home' }, connection: null, added: false, ...more });
  expect(stepAt(tutorial!, facts({}))).toBe(0);
  expect(stepAt(tutorial!, facts({ route: { kind: 'add-connection' } }))).toBe(1);
  expect(stepAt(tutorial!, facts({ route: { kind: 'connect-direct', address: '' } }))).toBe(2);
  expect(stepAt(tutorial!, facts({ connection: 'c' }))).toBe(3);
  expect(stepAt(tutorial!, facts({ connection: 'c', added: true }))).toBe(4);
  expect(stepAt(tutorial!, facts({ connection: 'c', added: true, route: { kind: 'new-chat', character: null } }))).toBeNull();
});
