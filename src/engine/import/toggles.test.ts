import { describe, expect, it } from 'vitest';
import { readToggles, writeToggles } from './toggles';

describe('readToggles', () => {
  it('reads every kind of line in order, a lowercase groupend as the group’s end, and keeps the lines it cannot read as written', () => {
    const text = [
      'sims=시뮬레이터 모드',
      '',
      '=분위기=group',
      'mood=분위기=select=밝게, 어둡게',
      'note=메모=text',
      'story=줄거리=textarea',
      '=끝=groupend',
      '==divider',
      '=설정=caption',
      '==groupEnd',
      '모드 고르기',
      '==caption',
      '=그룹=grounpEnd',
      'odd=이상한=other',
    ].join('\n');
    expect(readToggles(text)).toEqual([
      { key: 'sims', label: '시뮬레이터 모드', kind: 'check', default: '0' },
      { kind: 'group', label: '분위기' },
      { key: 'mood', label: '분위기', kind: 'choice', options: ['밝게', '어둡게'], default: '0' },
      { key: 'note', label: '메모', kind: 'text', default: '' },
      { key: 'story', label: '줄거리', kind: 'text', lines: true, default: '' },
      { kind: 'groupEnd' },
      { kind: 'divider', label: '' },
      { kind: 'caption', label: '설정' },
      { kind: 'groupEnd' },
      { kind: 'unread', text: '모드 고르기' },
      { kind: 'unread', text: '==caption' },
      { kind: 'unread', text: '=그룹=grounpEnd' },
      { kind: 'unread', text: 'odd=이상한=other' },
    ]);
  });

  it('is undone by writeToggles for every line it reads, an unread one as it was written', () => {
    const text = ['sims=시뮬레이터 모드', '=분위기=group', 'mood=분위기=select=밝게,어둡게', 'note=메모=text', 'story=줄거리=textarea', '==groupEnd', '==divider', '=설정=caption', ' 모드 고르기 ', 'odd=이상한=other'].join('\n');
    expect(writeToggles(readToggles(text))).toBe(text);
  });
});
