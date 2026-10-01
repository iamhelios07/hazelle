import { afterEach, expect, it, vi } from 'vitest';
import { exportBackup } from '../../runtime/backup';
import { downloadOutput } from './download';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('does not download Blob parts when an export is stopped', async () => {
  vi.stubGlobal('window', {});
  const click = vi.fn();
  vi.stubGlobal('document', { createElement: () => ({ click }) });
  const url = vi.spyOn(URL, 'createObjectURL');
  const abort = new AbortController();
  const output = await downloadOutput('backup.zip');
  const result = await exportBackup({
    scan: async (options, visit) => {
      await visit({ id: 'person', kind: 'persona', parent: null, rev: 1 }, options.metadata ? undefined : { name: '달', description: '', picture: null });
      return null;
    },
  }, { read: vi.fn() }, output, { signal: abort.signal, progress: (done) => { if (done) abort.abort(); } });
  expect(result).toEqual({ ok: false, error: 'stopped' });
  expect(click).not.toHaveBeenCalled();
  expect(url).not.toHaveBeenCalled();
});

it('opens the native picker synchronously and aborts its writable without closing it', async () => {
  const stream = { write: vi.fn(), close: vi.fn(), abort: vi.fn() };
  const picker = vi.fn(async () => ({ createWritable: async () => stream }));
  vi.stubGlobal('window', { showSaveFilePicker: picker });
  const pending = downloadOutput('backup.zip');
  expect(picker).toHaveBeenCalledOnce();
  const output = await pending;
  const chunk = new Uint8Array([1, 2, 3]);
  await output.write(chunk);
  await output.abort();
  expect(stream.write).toHaveBeenCalledWith(chunk);
  expect(stream.abort).toHaveBeenCalledOnce();
  expect(stream.close).not.toHaveBeenCalled();
});
