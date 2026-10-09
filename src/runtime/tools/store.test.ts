import { describe, expect, it, vi } from 'vitest';
import { readTool } from '../../engine/import/tool';
import { toolId } from '../../model/tool';
import { setModuleDeleted } from '../modules';
import { purgeNow } from '../removal';
import { exportBackup, readBackup, restoreBackup } from '../testing/backup';
import { testServer } from '../testing';
import { deleteToolData, importTool, setToolData, setToolSettings, toolData, toolDataId, toolKeys, TOOL_DATA_BYTES, TOOL_VALUE_BYTES, undoToolImport } from './store';

const server = testServer();
const source = (version = '1.0', uses = '') => {
  const result = readTool(new TextEncoder().encode(`//@api 1\n//@name notes\n//@author jin\n//@version ${version}\n${uses}//@setting {"key":"title","type":"text","label":"제목","default":"메모"}\nhazelle.on('message', () => {});`));
  if (!result.ok) throw new Error('fixture');
  return result.tool;
};

describe('tool storage', () => {
  it('updates the identity in place, retaining data and settings and resetting only expanded consent', async () => {
    const { store, files } = await server.account();
    const added = await importTool(store, files, source());
    if (!added.ok) throw new Error(added.error);
    const module = added.data.id;
    const changed = vi.fn();
    const tools = { warm: async () => {}, menus: () => [], page: () => () => {}, settingsChanged: changed };
    expect((await setToolSettings({ store, tools }, module, { title: 'mine' })).ok).toBe(true);
    expect(changed).toHaveBeenCalledWith(module);
    await setToolData(store, module, 'note', { text: 'hello' });
    await store.update('module', module, (current) => ({ ...current, botModels: true }));
    const updated = await importTool(store, files, source('1.1', '//@uses model\n'));
    if (!updated.ok) throw new Error(updated.error);
    expect(updated.data.id).toBe(module);
    expect(store.list('module')).toHaveLength(1);
    expect(store.get('module', module)!.value.botModels).toBeUndefined();
    expect(store.get('tool', toolId(module))!.value.settings).toEqual({ title: 'mine' });
    expect(toolData(store, module, 'note')).toEqual({ text: 'hello' });
    await store.update('module', module, (current) => ({ ...current, botModels: false }));
    await importTool(store, files, source('1.2', '//@uses model\n'));
    expect(store.get('module', module)!.value.botModels).toBe(false);
    await undoToolImport(store, module, updated.data.previous!);
    expect(store.get('tool', toolId(module))!.value.manifest.version).toBe('1.0');
    expect(await files.read(store.get('tool', toolId(module))!.value.file)).toEqual({ ok: true, data: source().bytes });
    expect(store.get('tool', toolId(module))!.value.settings.title).toBe('mine');
    const next = source('3');
    next.manifest.settings = [{ key: 'new', type: 'switch', label: 'New', default: true }];
    const replaced = await importTool(store, files, next);
    if (!replaced.ok) throw new Error(replaced.error);
    expect(store.get('tool', toolId(module))!.value.settings).toEqual({ title: 'mine', new: true });
    await undoToolImport(store, module, replaced.data.previous!);
    expect(store.get('tool', toolId(module))!.value.settings.title).toBe('mine');
  });

  it('does not revive a binned identity and purges both child kinds', async () => {
    const { store, files } = await server.account();
    const added = await importTool(store, files, source());
    if (!added.ok) throw new Error(added.error);
    const module = added.data.id;
    await setToolData(store, module, 'note', 'kept');
    await setModuleDeleted(store, module, Date.now());
    expect(await importTool(store, files, source('2'))).toEqual({ ok: false, error: 'gone' });
    expect(store.list('module')).toHaveLength(1);
    expect((await purgeNow(store, 'module', module, () => {})).ok).toBe(true);
    expect(store.list('tool')).toEqual([]);
    expect(store.list('tooldata')).toEqual([]);
  });

  it('addresses keys deterministically, updates and deletes, and enforces value and total limits', async () => {
    const { store, files } = await server.account();
    const added = await importTool(store, files, source());
    if (!added.ok) throw new Error(added.error);
    const module = added.data.id;
    expect(await toolDataId(module, 'a')).toBe(await toolDataId(module, 'a'));
    expect(await toolDataId(module, 'a')).not.toBe(await toolDataId(module, 'b'));
    expect((await setToolData(store, module, 'a', 1)).ok).toBe(true);
    expect((await setToolData(store, module, 'a', 2)).ok).toBe(true);
    expect(toolData(store, module, 'a')).toBe(2);
    expect(toolKeys(store, module)).toEqual(['a']);
    await deleteToolData(store, module, 'a');
    expect(toolData(store, module, 'a')).toBeUndefined();
    expect((await setToolData(store, module, 'a', '가'.repeat(TOOL_VALUE_BYTES / 3))).ok).toBe(false);
    const value = 'x'.repeat(TOOL_VALUE_BYTES - 2);
    for (let i = 0; i < TOOL_DATA_BYTES / TOOL_VALUE_BYTES; i++) expect((await setToolData(store, module, String(i), value)).ok).toBe(true);
    expect(await setToolData(store, module, 'extra', 1)).toEqual({ ok: false, error: 'too-large' });
    expect((await setToolData(store, module, '0', 1)).ok).toBe(true);
    expect((await setToolData(store, module, 'extra', 1)).ok).toBe(true);
  });

  it('round trips tool code, settings and data through an account backup', async () => {
    const old = await server.account();
    const imported = source();
    const added = await importTool(old.store, old.files, imported);
    if (!added.ok) throw new Error(added.error);
    await setToolData(old.store, added.data.id, 'note', 'backup note');
    const parts: BlobPart[] = [];
    expect((await exportBackup(old.store, old.files, { write: async (bytes) => { parts.push(bytes); }, close: async () => {}, abort: async () => {} })).ok).toBe(true);
    const read = await readBackup(new Blob(parts));
    if (!read.ok) throw new Error(read.error);
    await server.wipe();
    const restored = await server.account();
    expect(await restoreBackup(restored.store, restored.files, read.backup)).toEqual({ ok: true, data: { skipped: 0 } });
    const tool = restored.store.get('tool', toolId(added.data.id))!.value;
    expect(tool.manifest).toEqual(imported.manifest);
    expect(tool.settings).toEqual({ title: '메모' });
    expect(await restored.files.read(tool.file)).toEqual({ ok: true, data: imported.bytes });
    expect(toolData(restored.store, added.data.id, 'note')).toBe('backup note');
  });
});
