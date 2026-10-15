import { Check } from 'lucide-react';
import type { Stored } from '../../model/kinds';
import { toolId } from '../../model/tool';
import { ACTS, importOf } from '../common/acts';
import { counted, holdsLine, packParts, type PackParts } from '../common/pack';
import { useSearch } from '../common/useSearch';
import { ALWAYS, moduleName, PAGES, SCRIPTS } from '../common/words';
import { useChildrenOf, useLibrary, useModules, usePersonas, usePrompts, useSettings, useTools } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Empty, Icon, NavBar, Row, Screen, Table, Tag, type TableColumn } from '../ui';

// The table's columns and each module's contents line both come from these parts, so the two always agree.
export function useModuleParts(modules: readonly Stored<'module'>[]): PackParts[] {
  const ids = modules.map(({ id }) => id);
  const lore = useChildrenOf('lore', ids);
  const assets = useChildrenOf('asset', ids);
  const tools = new Set(useTools().map(({ id }) => id));
  return modules.map(({ id, value }, index) => packParts(value, lore[index]!.length, assets[index]!.length, tools.has(toolId(id))));
}

const holding = (owners: string[][], id: string) => owners.filter((modules) => modules.includes(id)).length;

const COLUMNS: TableColumn[] = [
  { label: PAGES.modules, size: 'name' },
  { label: '로어북', size: 'figure' },
  { label: SCRIPTS.regex, size: 'figure' },
  { label: SCRIPTS.triggers, size: 'figure' },
  { label: '토글', size: 'figure' },
  { label: '스타일', size: 'figure' },
  { label: '쓰는 곳', size: 'fill', keep: true },
];

const figure = (count: number) => (count > 0 ? count : null);

// onImport opens the app's file picker, which the shell hands over: a feature folder may not import the library's.
export function ModulesScreen({ back, onImport }: { back: Back | null; onImport: () => void }) {
  const modules = useModules();
  const prompts = usePrompts().flatMap(({ value }) => (value.task === undefined ? [value.modules ?? []] : []));
  const characters = useLibrary().characters.map(({ character }) => character.modules ?? []);
  const personas = usePersonas().map(({ value }) => value.modules ?? []);
  const always = useSettings().modules ?? [];
  const where = (id: string) => counted([['프롬프트', holding(prompts, id)], ['캐릭터', holding(characters, id)], ['페르소나', holding(personas, id)]]).join(' · ');
  const search = useSearch(modules, '모듈 검색', ({ value }) => [moduleName(value.name)]);
  const parts = useModuleParts(search.found);
  const importing = (
    <Button variant="secondary" icon={ACTS.import.icon} onClick={onImport}>
      {importOf('모듈')}
    </Button>
  );
  const rows = search.found.map(({ id, value }, index) => {
    const { lore, regex, triggers, toggles, style } = parts[index]!;
    const on = always.includes(id);
    const used = where(id);
    return {
      key: id,
      cells: [
        moduleName(value.name),
        figure(lore),
        figure(regex),
        figure(triggers),
        figure(toggles),
        style ? <Icon icon={Check} size="sm" /> : null,
        <>
          {on && <Tag>{ALWAYS}</Tag>}
          {on && used && ' '}
          {used}
        </>,
      ],
      summary: holdsLine(parts[index]!),
      onClick: () => navigate({ kind: 'module', id, pane: null }),
    };
  });
  return (
    <Screen width="page" top={<NavBar title={PAGES.modules} {...backBar(back)} actions={importing} />}>
      {search.field && <Row kind="toolbar">{search.field}</Row>}
      {search.none !== null ? (
        <Empty>{search.none}</Empty>
      ) : modules.length > 0 ? (
        <Table label={PAGES.modules} columns={COLUMNS} rows={rows} />
      ) : (
        <Empty action={importing}>모듈이 없어요.</Empty>
      )}
    </Screen>
  );
}
