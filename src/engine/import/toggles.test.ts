import { describe, expect, it } from 'vitest';
import { readToggles } from './toggles';

describe('readToggles', () => {
  it('reads key=label lines as checks that start off, and counts every other line it cannot read', () => {
    expect(readToggles('sims=시뮬레이터 모드\n\nmood=분위기=select=밝게,어둡게\n=그룹=group\n')).toEqual({
      toggles: [{ key: 'sims', label: '시뮬레이터 모드', kind: 'check', default: '0' }],
      unread: 2,
    });
  });
});
