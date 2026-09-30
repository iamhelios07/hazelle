import { describe, expect, it } from 'vitest';
import { fitsRole, resolveRole } from './assignment';
import type { Model } from './types';

describe('model assignment', () => {
  it('takes the most specific layer that sets the role', () => {
    const general = { main: { connection: 'c1', model: 'claude' } };
    const chat = { main: { connection: 'c2', model: 'gemini' } };
    expect(resolveRole('main', [chat, {}, general])).toEqual(chat.main);
    expect(resolveRole('main', [{}, general])).toEqual(general.main);
    expect(resolveRole('main', [{}, {}])).toBeNull();
  });

  it('falls back from 보조 모델 to 대화 모델 only after every layer is asked', () => {
    const main = { connection: 'c1', model: 'claude' };
    const aux = { connection: 'c1', model: 'haiku' };
    expect(resolveRole('aux', [{ main }, { aux }])).toEqual(aux);
    expect(resolveRole('aux', [{ main }, {}])).toEqual(main);
  });

  it('offers a model whose output is unknown, not one that cannot write text', () => {
    const model = (output: Model['output']) => ({ output }) as Model;
    expect(fitsRole(model(['text']), 'main')).toBe(true);
    expect(fitsRole(model(null), 'main')).toBe(true);
    expect(fitsRole(model(['image']), 'main')).toBe(false);
  });
});
