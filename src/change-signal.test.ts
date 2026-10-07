import { expect, it } from 'vitest';
import { ChangeSignal } from './change-signal';

it('keeps live Set delivery when a listener unsubscribes another and subscribes a new one', () => {
  const changes = new ChangeSignal();
  const calls: string[] = [];
  const added = () => calls.push('added');
  changes.subscribe(() => {
    calls.push('first');
    leave();
    changes.subscribe(added);
  });
  const leave = changes.subscribe(() => calls.push('removed'));
  changes.notify();
  changes.subscribe(added);
  changes.notify();
  expect(calls).toEqual(['first', 'added', 'first', 'added']);
  changes.clear();
  changes.notify();
  expect(calls).toEqual(['first', 'added', 'first', 'added']);
});

it('does not swallow a listener failure or notify later listeners after it', () => {
  const changes = new ChangeSignal();
  const error = new Error('listener failed');
  let called = false;
  changes.subscribe(() => { throw error; });
  changes.subscribe(() => { called = true; });
  expect(() => changes.notify()).toThrow(error);
  expect(called).toBe(false);
});
