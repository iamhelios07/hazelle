import { expect, it } from 'vitest';
import { blockConditions, blockEffects } from './blocks';

it('normalizes V1/V2 aliases to one operation model and retains unsupported source without executing wire data', () => {
  const first = [
    { type: 'setvar', operator: '+=', var: '{{name}}', value: '{{getvar::hp}}' },
    { type: 'impersonate', role: 'char', value: 'hello' },
    { type: 'modifychat', index: '1', value: 'changed' },
    { type: 'cutchat', start: '1', end: '3' },
    { type: 'command', value: '/cut -1' },
  ];
  const types = ['v2SetVar', 'v2Impersonate', 'v2ModifyChat', 'v2CutChat', 'v2Command'];
  const second = first.map((value, index) => ({ ...value, type: types[index], valueType: 'value', indexType: 'value', startType: 'value', endType: 'value', indent: 0 }));
  expect(blockEffects(second)).toEqual(blockEffects(first));
  expect(blockEffects(first)[0]).toEqual({ kind: 'set', name: '{{name}}', operator: 'add', value: { kind: 'text', text: '{{getvar::hp}}' } });
  const unsupported = { type: 'v2ImgGen', indent: 2, future: ['raw'] };
  expect(blockEffects([unsupported])).toEqual([{ kind: 'opaque', type: 'v2ImgGen', raw: unsupported }]);
  expect(blockConditions([{ type: 'var', var: 'hp', operator: 'unknown', value: '{{setvar::hp::0}}' }])).toEqual([{ kind: 'probe', source: { kind: 'variable', name: 'hp' } }]);
});
