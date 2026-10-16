import { EMPTY_SETTINGS } from '../../model/settings';
import { switched } from '../../runtime/modules';
import { LABS, type LabId } from '../common/labs';
import { PAGES } from '../common/words';
import { useSettings, useStore } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Empty, NavBar, Panel, Screen, SettingGroup, SettingRow, Switch } from '../ui';
import { REPORT } from './ReportDialog';

const RUNNING = '실험 중인 기능';

export function LabsScreen({ back }: { back: Back | null }) {
  const on = useSettings().labs ?? [];
  const store = useStore();
  const toast = useToast();

  async function flip(id: LabId, next: boolean) {
    const saved = await store.upsert('settings', (settings = EMPTY_SETTINGS) => ({ ...settings, labs: switched(settings.labs, id, next) }));
    if (!saved.ok) toast.failed(saved);
  }

  return (
    <Screen width="page" top={<NavBar title={PAGES.labs} {...backBar(back)} />}>
      <Panel title={RUNNING} help={`먼저 써 보는 새 기능이에요. 언제든 끌 수 있고, 의견은 ${PAGES.account}의 '${REPORT}'로 보내 주세요.`}>
        {LABS.length === 0 ? (
          <Empty variant="section">지금은 {RUNNING}이 없어요.</Empty>
        ) : (
          <SettingGroup label={RUNNING}>
            {LABS.map((lab) => (
              <SettingRow key={lab.id} label={lab.name} help={lab.help} control={<Switch label={lab.name} checked={on.includes(lab.id)} onChange={(next) => void flip(lab.id, next)} />} />
            ))}
          </SettingGroup>
        )}
      </Panel>
    </Screen>
  );
}
