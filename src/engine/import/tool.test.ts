import { describe, expect, it } from 'vitest';
import { readTool, TOOL_FILE_BYTES } from './tool';

const read = (source: string) => readTool(new TextEncoder().encode(source));
const header = '//@api 1\n//@name notes\n//@author jin\n';

describe('tool header', () => {
  it('reads only the leading declarations and never evaluates the code', () => {
    const result = read(`\ufeff${header}//@display-name 메모\n//@version 1.0\n//@uses model\n//@page 열기\n//@menu clear 지우기\n//@setting {"key":"count","type":"number","label":"개수","default":3}\n//@future ignored\nthrow new Error('never run');\n//@name wrong`);
    expect(result).toMatchObject({ ok: true, tool: { manifest: { api: 1, name: 'notes', author: 'jin', displayName: '메모', version: '1.0', uses: ['model'], page: { label: '열기' }, menu: [{ id: 'clear', label: '지우기' }], settings: [{ key: 'count', type: 'number', default: 3 }] } } });
  });

  it.each([
    '//@api 2\n//@name notes\n//@author jin',
    '//@api 1\n//@author jin',
    '//@api 1\n//@name notes',
    `${header}//@setting nope`,
    `${header}//@setting {"key":"n","type":"number","label":"N","default":"3"}`,
    `${header}//@setting {"key":"n","type":"choice","label":"N","options":["a"],"default":"b"}`,
    `${header}//@name ../notes`,
    `${header}//@uses network`,
  ])('refuses an unsupported or malformed declaration: %s', (source) => {
    expect(read(source)).toMatchObject({ ok: false, failure: { kind: 'unreadable' } });
  });

  it('refuses duplicate settings and menus and files over the byte cap', () => {
    const field = '//@setting {"key":"x","type":"text","label":"X"}\n';
    expect(read(header + field + field).ok).toBe(false);
    expect(read(header + '//@menu x X\n//@menu x X').ok).toBe(false);
    expect(readTool(new Uint8Array(TOOL_FILE_BYTES + 1))).toMatchObject({ ok: false, failure: { detail: 'tool-too-large' } });
    expect(readTool(new Uint8Array([0xff]))).toMatchObject({ ok: false, failure: { detail: 'tool-encoding' } });
  });
});
