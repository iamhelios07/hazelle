import { useState } from 'react';
import type { MemorySettings } from '../../model/memory';
import { Disclosure, NumberInput, SettingGroup, SettingRow, Switch } from '../ui';

type Count = 'budget' | 'window' | 'batch';

const COUNTS = {
  budget: { label: '기억 예산', unit: '토큰', help: '장기 기억 자리가 요청마다 쓸 수 있는 토큰이에요. 모델이 받을 수 있는 것보다 크면 그 요청에서만 줄여요.' },
  window: { label: '최근 원문', unit: '토큰', help: '최근 메시지는 이만큼까지 늘 쓴 그대로 보내고, 기록으로 정리하지 않아요.' },
  batch: { label: '정리 단위', unit: '토큰', help: '최근 원문보다 앞에서 정리하지 않은 메시지가 이만큼 쌓이면 기록으로 정리해요.' },
} satisfies Record<Count, { label: string; unit: string; help: string }>;

export const settingsOf = ({ on, budget, window, batch }: MemorySettings): MemorySettings => ({ on, budget, window, batch });

const readCount = (draft: string) => {
  const value = Number(draft);
  return draft.trim() !== '' && Number.isSafeInteger(value) && value >= 1 ? value : null;
};

// The memory settings, the account's default or a chat's own. A number is passed on only once it is valid. A caller
// that resets the values from outside remounts this, so numbers typed before do not stand over the reset.
export function MemoryFields({ value, onChange }: { value: MemorySettings; onChange: (change: Partial<MemorySettings>) => void }) {
  const [drafts, setDrafts] = useState<Partial<Record<Count, string>>>({});
  const row = (field: Count) => {
    const { label, unit, help } = COUNTS[field];
    const draft = drafts[field] ?? String(value[field]);
    const invalid = readCount(draft) === null;
    const type = (next: string) => {
      setDrafts((current) => ({ ...current, [field]: next }));
      const count = readCount(next);
      if (count !== null) onChange({ [field]: count });
    };
    return (
      <SettingRow
        key={field}
        label={label}
        help={help}
        error={invalid ? '1 이상의 정수로 적어 주세요.' : undefined}
        control={<NumberInput label={label} unit={unit} value={draft} invalid={invalid} onChange={type} />}
      />
    );
  };
  return (
    <>
      <SettingGroup label="장기 기억">
        <SettingRow
          label="장기 기억"
          help="지난 이야기를 기록으로 정리해 프롬프트의 장기 기억 자리에 넣어요. 끄면 컨텍스트 한도를 넘는 오래된 메시지는 그냥 빠져요."
          control={<Switch label="장기 기억" checked={value.on} onChange={(on) => onChange({ on })} />}
        />
        {row('budget')}
      </SettingGroup>
      <Disclosure label="세부 설정">
        <SettingGroup label="세부 설정">
          {row('window')}
          {row('batch')}
        </SettingGroup>
      </Disclosure>
    </>
  );
}
