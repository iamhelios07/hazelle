import { describe, expect, it } from 'vitest';
import { stepFrom, storyStops } from './storySteps';

describe('story steps', () => {
  // 0 reply, 1 user, 2 reply, 3 user, 4 reply.
  const stops = storyStops([{ role: 'assistant' }, { role: 'user' }, { role: 'assistant' }, { role: 'user' }, { role: 'assistant' }], false);

  it('passes over the user’s lines, but not the one the view is inside', () => {
    expect(stops).toEqual([0, 2, 4]);
    expect(stepFrom(stops, 4, { index: 2, above: 0, below: 300 }, 'up')).toEqual({ index: 0, lands: 'top' });
    expect(stepFrom(stops, 4, { index: 3, above: 200, below: 300 }, 'up')).toEqual({ index: 3, lands: 'top' });
    expect(stepFrom(stops, 4, { index: 1, above: 300, below: 0 }, 'down')).toEqual({ index: 2, lands: 'bottom' });
    expect(stepFrom(stops, 4, { index: 2, above: 300, below: 0 }, 'down')).toBe('end');
  });
});
