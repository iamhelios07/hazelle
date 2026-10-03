import { expect, it } from 'vitest';
import type { ObjectStore } from '../../runtime/store';
import { readPreset } from './PresetImport';

it('answers a file that cannot be read with a failure of its own', async () => {
  const folder = { name: 'presets', arrayBuffer: () => Promise.reject(new DOMException('', 'NotReadableError')) } as unknown as File;
  expect(await readPreset({} as ObjectStore, folder)).toEqual({ file: 'presets', failure: expect.stringContaining('읽지 못했어요') });
});
