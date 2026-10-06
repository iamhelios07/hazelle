import { Import } from 'lucide-react';
import type { Stored } from '../../model/kinds';
import { packHolds } from '../common/pack';
import { ALWAYS, moduleName, PAGES } from '../common/words';
import { useChildren, useLibrary, useModules, usePrompts, useSettings } from '../session';
import { backBar, navigate, useRoute } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Empty, List, ListItem, NavBar, Screen } from '../ui';

export function useHolds({ id, value }: Stored<'module'>): string {
  return packHolds(value, useChildren('lore', id).length, useChildren('asset', id).length);
}

const counted = (name: string, owners: string[][], id: string) => {
  const count = owners.filter((modules) => modules.includes(id)).length;
  return count > 0 ? [`${name} ${count}`] : [];
};

// onImport opens the app's file picker, which the shell hands over: a feature folder may not import the library's.
export function ModulesScreen({ back, onImport }: { back: Back | null; onImport: () => void }) {
  const modules = useModules();
  const prompts = usePrompts().flatMap(({ value }) => (value.task === undefined ? [value.modules ?? []] : []));
  const characters = useLibrary().characters.map(({ character }) => character.modules ?? []);
  const always = useSettings().modules ?? [];
  const where = (id: string) => {
    const places = [...counted('프롬프트', prompts, id), ...counted('캐릭터', characters, id)];
    return places.length > 0 ? places.join(' · ') : always.includes(id) ? undefined : '사용처 없음';
  };
  return (
    <Screen
      top={
        <NavBar
          title={PAGES.modules}
          {...backBar(back)}
          actions={
            <Button variant="secondary" size="sm" icon={Import} onClick={onImport}>
              모듈 가져오기
            </Button>
          }
        />
      }
    >
      {modules.length > 0 ? (
        <List label={PAGES.modules}>
          {modules.map((stored) => (
            <ModuleRow key={stored.id} stored={stored} always={always.includes(stored.id)} where={where(stored.id)} />
          ))}
        </List>
      ) : (
        <Empty variant="section">모듈이 없어요.</Empty>
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
