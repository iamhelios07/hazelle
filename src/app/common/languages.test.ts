import { describe, expect, it } from 'vitest';
import { languageLabel, withRo } from './languages';

describe('withRo', () => {
  it('takes 로 after a vowel or ㄹ, 으로 after another final consonant, and (으)로 when the sound is not known', () => {
    expect(withRo(languageLabel('English'))).toBe('영어로');
    expect(withRo('서울')).toBe('서울로');
    expect(withRo(languageLabel('Chinese (Simplified)'))).toBe('중국어 간체로');
    expect(withRo('중국어 번역문')).toBe('중국어 번역문으로');
    expect(withRo(languageLabel('Klingon'))).toBe('Klingon(으)로');
  });
});
