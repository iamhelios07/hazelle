import { describe, expect, it } from 'vitest';
import { revealStep } from './useReveal';

describe('revealStep', () => {
  it('spreads a burst over the wait for the next one, keeps a slow trickle moving, and never passes what arrived', () => {
    let shown = 0;
    for (let frame = 0; frame < 30; frame++) shown = revealStep(shown, 300, 1000 / 60);
    expect(shown).toBeGreaterThan(100);
    expect(shown).toBeLessThan(300);
    expect(revealStep(0, 2, 1000)).toBe(2);
    expect(revealStep(5, 5, 16)).toBe(5);
  });
});
