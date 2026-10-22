import { expect, expectTypeOf, it } from 'vitest';
import { joinParts } from './joinParts';

it('joins disjoint data and actions without losing their inferred types', () => {
  const actions = joinParts({ send: (text: string) => text.length }, { stop: () => {} }, { pick: (index: number) => index });
  const data = joinParts({ busy: false }, { text: 'hello' }, { actions });
  expectTypeOf(data.actions.send).toEqualTypeOf<(text: string) => number>();
  expect(data.text).toBe('hello');
  expect(data.actions.send(data.text)).toBe(5);

  // @ts-expect-error Two features cannot offer the same action, even with identical signatures.
  joinParts({ send: actions.send }, { stop: actions.stop }, { send: actions.send });
  // @ts-expect-error The inline data cannot overwrite a feature's data.
  joinParts({ busy: false }, { text: 'hello' }, { busy: true });

  const conditional = (part: { busy: boolean } | { text: string }) => {
    // @ts-expect-error A key offered by only one branch can still collide.
    joinParts(part, { busy: false });
  };
  conditional({ text: 'hello' });
});
