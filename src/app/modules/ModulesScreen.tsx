import { Import } from 'lucide-react';
import type { Stored } from '../../model/kinds';
import { packHolds } from '../common/pack';
import { ALWAYS, PAGES } from '../common/words';
import { useCount, useModules, useSettings } from '../session';
import { backBar, navigate, useRoute } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Empty, List, ListItem, NavBar, Screen } from '../ui';

export function useHolds({ id, value }: Stored<'module'>): string {
  return packHolds(value, useCount('lore', id), useCount('asset', id));
}

// onImport opens the app's file picker, which the shell hands over: a feature folder may not import the library's.
export function ModulesScreen({ back, onImport }: { back: Back | null; onImport: () => void }) {
  const modules = useModules();
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
            <ModuleRow key={stored.id} stored={stored} />
          ))}
        </List>
      ) : (
        <Empty variant="section">아직 모듈이 없어요. 모듈 파일(.risum)을 화면에 끌어다 놓거나 모듈 가져오기로 골라 주세요.</Empty>
      )}
    </Screen>
  );
}

function ModuleRow({ stored }: { stored: Stored<'module'> }) {
  const route = useRoute();
  const always = useSettings().modules?.includes(stored.id);
  return (
    <ListItem
      title={stored.value.name}
      tags={always ? [ALWAYS] : []}
      description={useHolds(stored)}
      current={route.kind === 'module' && route.id === stored.id}
      onClick={() => navigate({ kind: 'module', id: stored.id })}
    />
  );
}
