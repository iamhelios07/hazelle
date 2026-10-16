import { describe, expect, it } from 'vitest';
import { languageLabel } from './languages';
import { particleOf, withParticle } from './particles';

describe('withParticle', () => {
  it('takes 로 after a vowel or ㄹ, 으로 after another final consonant, and (으)로 when the sound is not known', () => {
    expect(withParticle(languageLabel('English'), '으로/로')).toBe('영어로');
    expect(withParticle('서울', '으로/로')).toBe('서울로');
    expect(withParticle(languageLabel('Chinese (Simplified)'), '으로/로')).toBe('중국어 간체로');
    expect(withParticle('중국어 번역문', '으로/로')).toBe('중국어 번역문으로');
    expect(withParticle(languageLabel('Klingon'), '으로/로')).toBe('Klingon(으)로');
  });

  it('reads past closing quotes, reads numbers as said, and shows both forms of the other pairs when unknown', () => {
    expect(withParticle("'대화 뒤 지시문'", '이/가')).toBe("'대화 뒤 지시문'이");
    expect(withParticle("'시스템 프롬프트'", '이/가')).toBe("'시스템 프롬프트'가");
    expect(withParticle('켜고 끄기', '을/를')).toBe('켜고 끄기를');
    expect(withParticle('그룹 1', '으로/로')).toBe('그룹 1로');
    expect(withParticle('그룹 3', '으로/로')).toBe('그룹 3으로');
    expect(withParticle('그룹 10', '이/가')).toBe('그룹 10이');
    expect(withParticle('Main', '이/가')).toBe('Main이(가)');
    expect(particleOf('Main', '을/를')).toBe('을(를)');
  });
});
