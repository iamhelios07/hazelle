import { describe, expect, it } from 'vitest';
import { revealCut, revealStep } from './useReveal';

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

describe('revealCut', () => {
  it('never ends inside a tag, and leaves a < in prose alone', () => {
    const picture = '<div class="risu-inlay-image"><img src="blob:x"></div>\n';
    const img = picture.indexOf('<img');
    const close = picture.indexOf('</div>');
    expect(revealCut(picture, close + 1)).toBe(close);
    expect(revealCut(picture, close + 2)).toBe(close);
    expect(revealCut(picture, img + 8)).toBe(img);
    expect(revealCut(picture, close)).toBe(close);
    expect(revealCut(picture, picture.length)).toBe(picture.length);
    expect(revealCut('a < b and <3 more', 3)).toBe(3);
    expect(revealCut('a <3 more', 3)).toBe(3);
  });
});
