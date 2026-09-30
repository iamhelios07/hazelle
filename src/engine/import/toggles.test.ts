import { describe, expect, it } from 'vitest';
import { readToggles } from './toggles';

describe('readToggles', () => {
  it('reads checks and choices that start at their first value, and counts every other line it cannot read', () => {
    expect(readToggles('sims=시뮬레이터 모드\n\nmood=분위기=select=밝게, 어둡게\n=그룹=group\nnote=메모=text\n')).toEqual({
      toggles: [
        { key: 'sims', label: '시뮬레이터 모드', kind: 'check', default: '0' },
        { key: 'mood', label: '분위기', kind: 'choice', options: ['밝게', '어둡게'], default: '0' },
      ],
      unread: 2,
    });
  });
});
