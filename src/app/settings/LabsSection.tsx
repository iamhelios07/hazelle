import { EMPTY_SETTINGS } from '../../model/settings';
import { LABS, type LabId } from '../common/labs';
import { useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { Empty, Panel, SettingRow, Switch } from '../ui';
import { REPORT } from './ReportDialog';

export function LabsSection() {
  const on = useSettings().labs ?? [];
  const store = useStore();
  const toast = useToast();

  async function flip(id: LabId, next: boolean) {
    const saved = await store.upsert('settings', (settings = EMPTY_SETTINGS) => {
      const kept = (settings.labs ?? []).filter((other) => other !== id);
      return { ...settings, labs: next ? [...kept, id] : kept };
    });
    if (!saved.ok) toast.failed(saved);
  }

  return (
    <Panel title="실험실" help={`먼저 써 보는 새 기능이에요. 언제든 끌 수 있고, 의견은 '${REPORT}'로 보내 주세요.`} empty={LABS.length === 0}>
      {LABS.length === 0 && <Empty variant="section">지금은 실험 중인 기능이 없어요.</Empty>}
      {LABS.map((lab) => (
        <SettingRow key={lab.id} label={lab.name} help={lab.help} control={<Switch label={lab.name} checked={on.includes(lab.id)} onChange={(next) => void flip(lab.id, next)} />} />
      ))}
    </Panel>
  );
}
