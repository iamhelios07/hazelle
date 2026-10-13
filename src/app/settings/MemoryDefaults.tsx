import { retrievalRoom } from '../../engine/retrieval';
import type { MemorySettings } from '../../model/memory';
import { defaultMemory } from '../../runtime/memory-read';
import { setDefaultMemory } from '../../runtime/memory';
import { MEMORY_HELP, MemoryFields } from '../common/MemoryFields';
import { count } from '../common/typedNumber';
import { useAutosave } from '../common/useAutosave';
import { MODEL_ROLES } from '../common/words';
import { useSettings, useStore } from '../session';
import { Breakdown, Panel, Switch } from '../ui';

const amount = (tokens: number) => `${count(tokens)} 토큰`;

export function MemoryDefaults() {
  const store = useStore();
  // Subscribed for its changes: defaultMemory reads the settings from the store.
  useSettings();
  const save = useAutosave<MemorySettings>('memory-defaults', (patch) => setDefaultMemory(store, patch));
  const value = { ...defaultMemory(store), ...save.unsaved };
  const found = retrievalRoom(value.budget);
  const sum = value.budget + found + value.window;
  return (
    <Panel
      title="장기 기억"
      help={`${MEMORY_HELP} 채팅마다 장기 기억 패널에서 바꿀 수 있어요.`}
      action={<Switch label="장기 기억" checked={value.on} onChange={(on) => save.change({ on })} />}
    >
      {/* Off, a request fills no memory slot, so this split is not what it sends. */}
      {value.on && (
        <Breakdown
          total={{ label: '요청마다 보내는 기록과 대화', value: `최대 ${amount(sum)}` }}
          shares={[value.budget / sum, found / sum, value.window / sum]}
          parts={[
            { label: '기록 최대 분량', value: amount(value.budget), mark: 'accent' },
            { label: `${MODEL_ROLES.embed}로 찾는 기록`, value: `최대 ${amount(found)}`, mark: 'outline' },
            { label: '원문으로 보낼 최근 대화', value: amount(value.window), mark: 'plain' },
          ]}
        />
      )}
      <MemoryFields place="panel" value={value} onChange={save.change} />
    </Panel>
  );
}
