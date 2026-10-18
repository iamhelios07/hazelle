import { toolId } from '../../model/tool';
import { ACTS, importOf } from '../common/acts';
import { useImport } from '../common/importing';
import { useSearch } from '../common/useSearch';
import { moduleName, PAGES, toolVersion } from '../common/words';
import { useModulesAndPlugins, useTools } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Empty, NavBar, Row, Screen, Table, Tag, type TableColumn, type TableRow } from '../ui';
import { useModuleUse } from './ModulesScreen';

const COLUMNS: TableColumn[] = [
  { label: PAGES.plugins, size: 'name' },
  { label: '버전', size: 'fill' },
  { label: '쓰는 곳', size: 'fill', keep: true },
];

export function PluginsScreen({ back }: { back: Back | null }) {
  const { pick } = useImport();
  const { plugins } = useModulesAndPlugins();
  const tools = new Map(useTools().map((tool) => [tool.id, tool.value.manifest]));
  const use = useModuleUse();
  const search = useSearch(plugins, '플러그인 검색', ({ value }) => [moduleName(value.name)]);
  const importing = (
    <Button variant="secondary" icon={ACTS.import.icon} onClick={pick}>
      {importOf(PAGES.plugins)}
    </Button>
  );
  const rows: TableRow[] = search.found.map(({ id, value }) => {
    const manifest = tools.get(toolId(id))!;
    return {
      key: id,
      cells: [
        <>
          {moduleName(value.name)}
          {manifest.risu && ' '}
          {manifest.risu && <Tag>Risu</Tag>}
        </>,
        toolVersion(manifest.version),
        use.cell(id),
      ],
      summary: toolVersion(manifest.version),
      onClick: () => navigate({ kind: 'plugin', id }),
    };
  });
  return (
    <Screen width="page" top={<NavBar title={PAGES.plugins} {...backBar(back)} actions={importing} />}>
      {search.field && <Row kind="toolbar">{search.field}</Row>}
      {search.none !== null ? (
        <Empty>{search.none}</Empty>
      ) : rows.length > 0 ? (
        <Table label={PAGES.plugins} columns={COLUMNS} rows={rows} />
      ) : (
        <Empty action={importing}>플러그인이 없어요.</Empty>
      )}
    </Screen>
  );
}
