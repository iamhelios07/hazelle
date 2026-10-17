import { Check, Folder, FolderInput } from 'lucide-react';
import type { Stored } from '../../model/kinds';
import { toolId } from '../../model/tool';
import { ACTS, importOf } from '../common/acts';
import { useImport } from '../common/importing';
import { counted, holdsLine, packParts, type PackParts } from '../common/pack';
import { useSearch } from '../common/useSearch';
import { folderNote, placeIn, useFolderIndex, whereIs } from '../common/folders/filing';
import { FolderPath, useMoving, useNaming } from '../common/folders/FolderParts';
import { ALWAYS, moduleName, PAGES, SCRIPTS } from '../common/words';
import { useChildrenOf, useLibrary, useModules, usePersonas, usePrompts, useSettings, useTools } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Empty, Icon, NavBar, Row, Screen, Table, Tag, type TableColumn, type TableRow } from '../ui';

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
const folderOf = ({ value }: Stored<'module'>) => value.folder ?? null;
const go = (place: string | null) => navigate({ kind: 'modules', place });

// place: the folder it stands in.
export function ModulesScreen({ place, back }: { place: string | null; back: Back | null }) {
  const { pick } = useImport();
  const modules = useModules();
  const prompts = usePrompts().flatMap(({ value }) => (value.task === undefined ? [value.modules ?? []] : []));
  const characters = useLibrary().characters.map(({ character }) => character.modules ?? []);
  const personas = usePersonas().map(({ value }) => value.modules ?? []);
  const always = useSettings().modules ?? [];
  const where = (id: string) => counted([['프롬프트', holding(prompts, id)], ['캐릭터', holding(characters, id)], ['페르소나', holding(personas, id)]]).join(' · ');
  const search = useSearch(modules, '모듈 검색', ({ value }) => [moduleName(value.name)]);
  const index = useFolderIndex('module', modules, folderOf);
  const at = placeIn(index, place, search.words !== '');
  const naming = useNaming('module');
  const moving = useMoving('module', index, (id) => modules.find((module) => module.id === id)?.value.folder ?? null);
  const shown = at.placed(search.found);
  const parts = useModuleParts(shown);
  const importing = (
    <Button variant="secondary" icon={ACTS.import.icon} onClick={pick}>
      {importOf('모듈')}
    </Button>
  );
  const folderRows: TableRow[] = at.folders.map((folder) => ({
    key: folder.id,
    icon: Folder,
    cells: [folder.value.name, '', '', '', '', '', folderNote('module', index.byFolder.get(folder.id)!)],
    onDropCard: moving.dropInto?.(folder.id),
    onClick: () => go(folder.id),
  }));
  const rows: TableRow[] = shown.map((module, position) => {
    const { id, value } = module;
    const { lore, regex, triggers, toggles, style } = parts[position]!;
    const on = always.includes(id);
    const used = where(id);
    const path = search.words ? whereIs(index, folderOf(module)) : undefined;
    return {
      key: id,
      selected: moving.picked ? moving.picked.has(id) : undefined,
      drag: moving.dropInto && id,
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
      summary: [path, holdsLine(parts[position]!)].filter(Boolean).join(' · '),
      onClick: () => (moving.picked ? moving.toggle(id) : navigate({ kind: 'module', id, pane: null })),
    };
  });
  return (
    <Screen width="page" top={<NavBar title={PAGES.modules} {...backBar(back)} actions={importing} />}>
      {search.field && <Row kind="toolbar">{search.field}</Row>}
      {modules.length + index.folders.length > 0 && (
        <FolderPath kind="module" path={at.path} onGo={go} onName={naming.name} dropInto={moving.dropInto}>
          <Button variant="secondary" size="sm" icon={FolderInput} onClick={moving.pick}>
            {moving.picked ? '완료' : '선택해서 옮기기'}
          </Button>
        </FolderPath>
      )}
      {search.none !== null ? (
        <Empty>{search.none}</Empty>
      ) : folderRows.length + rows.length > 0 ? (
        <Table label={PAGES.modules} columns={COLUMNS} rows={[...folderRows, ...rows]} />
      ) : at.here ? (
        <Empty>비어 있는 폴더예요.</Empty>
      ) : (
        <Empty action={importing}>모듈이 없어요.</Empty>
      )}
      {moving.bar}
      {naming.dialog}
    </Screen>
  );
}
