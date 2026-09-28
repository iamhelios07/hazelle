import { describe, expect, it } from 'vitest';
import { calc } from './math';

describe('calc', () => {
  const none = () => 0;

  it('keeps precedence, left-associates every operator, ^ included, and gives comparisons and logic as 1 or 0', () => {
    expect([' 1 + 2 * 3', '2^3^2', '-2^2', '(1+2)*-3', '7%4', '3>2 && 1<=0', '!0 || 0', '2==2'].map((expression) => calc(expression, none))).toEqual([7, 64, 4, -9, 3, 0, 1, 1]);
  });

  it('reads $ and @ tokens through its reader, and gives null for an expression it cannot read', () => {
    expect(calc('$hp + @toggle_x', (token) => (token === '$hp' ? 10 : 1))).toBe(11);
    expect(['2 + abc', '1 +', '(1', '', '1)'].map((expression) => calc(expression, none))).toEqual([null, null, null, null, null]);
  });
});
