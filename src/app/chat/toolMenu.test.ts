import { expect, it } from 'vitest';
import type { ToolManifest } from '../../tool-api/manifest';
import { toolMenu } from './toolMenu';

const manifest = (displayName: string, page: ToolManifest['page'], menu: ToolManifest['menu']): ToolManifest => ({ api: 1, name: displayName, author: 'author', displayName, version: '1', description: '', uses: [], page, menu, settings: [] });

it('lists declared pages and actions in pack order, each under its own module identity', () => {
  expect(toolMenu([
    { module: 'notes', manifest: manifest('메모장', { label: '메모장 열기' }, []) },
    { module: 'silent', manifest: manifest('자동 도구', null, []) },
    { module: 'memory', manifest: manifest('기억', { label: '기억 열기' }, [{ id: 'now', label: '지금 정리하기' }, { id: 'clear', label: '내용 비우기' }]) },
  ])).toEqual([
    { kind: 'page', module: 'notes', name: '메모장', label: '메모장 열기' },
    { kind: 'page', module: 'memory', name: '기억', label: '기억 열기' },
    { kind: 'menu', module: 'memory', name: '기억', label: '지금 정리하기', item: 'now' },
    { kind: 'menu', module: 'memory', name: '기억', label: '내용 비우기', item: 'clear' },
  ]);
  expect(toolMenu([])).toEqual([]);
});
