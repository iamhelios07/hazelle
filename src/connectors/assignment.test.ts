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

  it('falls back from a task role to 기본 보조, then to 본 대화, only after every layer is asked', () => {
    const main = { connection: 'c1', model: 'claude' };
    const aux = { connection: 'c1', model: 'haiku' };
    const translate = { connection: 'c2', model: 'gemini' };
    expect(resolveRole('translate', [{ main }, { aux }])).toEqual(aux);
    expect(resolveRole('translate', [{ main }, {}])).toEqual(main);
    expect(resolveRole('translate', [{ aux }, { translate }])).toEqual(translate);
  });

  it('offers a model whose output is unknown, not one that cannot write text', () => {
    const model = (output: Model['output']) => ({ output }) as Model;
    expect(fitsRole(model(['text']), 'main')).toBe(true);
    expect(fitsRole(model(null), 'main')).toBe(true);
    expect(fitsRole(model(['image']), 'main')).toBe(false);
  });
});
