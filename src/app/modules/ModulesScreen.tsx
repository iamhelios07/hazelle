import type { Stored } from '../../model/kinds';
import { ACTS } from '../common/acts';
import { counted, packHolds } from '../common/pack';
import { useSearch } from '../common/useSearch';
import { ALWAYS, moduleName, PAGES } from '../common/words';
import { useChildren, useLibrary, useModules, usePrompts, useSettings, useTool } from '../session';
import { backBar, navigate, useRoute } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Empty, List, ListItem, NavBar, Row, Screen } from '../ui';

export function useHolds({ id, value }: Stored<'module'>): string {
  return packHolds(value, useChildren('lore', id).length, useChildren('asset', id).length, useTool(id) !== null);
}

const holding = (owners: string[][], id: string) => owners.filter((modules) => modules.includes(id)).length;

// onImport opens the app's file picker, which the shell hands over: a feature folder may not import the library's.
export function ModulesScreen({ back, onImport }: { back: Back | null; onImport: () => void }) {
  const modules = useModules();
  const prompts = usePrompts().flatMap(({ value }) => (value.task === undefined ? [value.modules ?? []] : []));
  const characters = useLibrary().characters.map(({ character }) => character.modules ?? []);
  const always = useSettings().modules ?? [];
  const where = (id: string) => counted([['프롬프트', holding(prompts, id)], ['캐릭터', holding(characters, id)]]).join(' · ') || undefined;
  const search = useSearch(modules, '모듈 검색', ({ value }) => [moduleName(value.name)]);
  return (
    <Screen
      width="form"
      top={
        <NavBar
          title={PAGES.modules}
          {...backBar(back)}
          actions={
            <Button variant="secondary" icon={ACTS.import.icon} onClick={onImport}>
              모듈 가져오기
            </Button>
          }
        />
      }
    >
      {search.field && <Row kind="toolbar">{search.field}</Row>}
      {search.none !== null ? (
        <Empty>{search.none}</Empty>
      ) : modules.length > 0 ? (
        <List label={PAGES.modules}>
          {search.found.map((stored) => (
            <ModuleRow key={stored.id} stored={stored} always={always.includes(stored.id)} where={where(stored.id)} />
          ))}
        </List>
      ) : (
        <Empty>모듈이 없어요.</Empty>
      )}
    </Screen>
  );
}

function ModuleRow({ stored, always, where }: { stored: Stored<'module'>; always: boolean; where: string | undefined }) {
  const route = useRoute();
  return (
    <ListItem
      title={moduleName(stored.value.name)}
      tags={always ? [ALWAYS] : []}
      description={useHolds(stored)}
      aside={where}
      current={route.kind === 'module' && route.id === stored.id}
      onClick={() => navigate({ kind: 'module', id: stored.id })}
    />
  );
}
