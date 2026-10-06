import { useState } from 'react';
import type { MemorySettings } from '../../model/memory';
import { typedText } from './typed';
import { Disclosure, NumberInput, SettingGroup, SettingRow, Switch } from '../ui';

type Count = 'budget' | 'window' | 'batch';

const COUNTS = {
  budget: { label: '기록에 쓸 양', unit: '토큰', help: '정리해 둔 기록을 요청마다 이만큼까지 넣어요. 모델이 받을 수 있는 것보다 크면 그 요청에서만 줄여요.' },
  window: { label: '그대로 보낼 최근 대화', unit: '토큰', help: '최근 대화는 이만큼까지 정리하지 않고 쓴 그대로 보내요.' },
  batch: { label: '한 번에 정리할 양', unit: '토큰', help: '그보다 오래된 대화가 이만큼 쌓일 때마다 기록으로 정리해요.' },
} satisfies Record<Count, { label: string; unit: string; help: string }>;

export const settingsOf = ({ on, budget, window, batch }: MemorySettings): MemorySettings => ({ on, budget, window, batch });

const readCount = (draft: string) => {
  const value = Number(draft);
  return draft.trim() !== '' && Number.isSafeInteger(value) && value >= 1 ? value : null;
};

// A number is passed on only once it is valid. A caller that resets the values from outside remounts this, so a number
// typed and not valid does not stand over the reset.
export function MemoryFields({ value, onChange }: { value: MemorySettings; onChange: (change: Partial<MemorySettings>) => void }) {
  const [drafts, setDrafts] = useState<Partial<Record<Count, string>>>({});
  const row = (field: Count) => {
    const { label, unit, help } = COUNTS[field];
    const draft = typedText(drafts[field], readCount, value[field], String);
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
          label="사용"
          help="오래된 대화를 기록으로 정리해 두고 모델에게 함께 보내요. 끄면 모델이 한 번에 읽을 수 있는 양을 넘는 옛 대화는 빠져요."
          control={<Switch label="장기 기억" checked={value.on} onChange={(on) => onChange({ on })} />}
        />
      </SettingGroup>
      <Disclosure label="세부 설정">
        <SettingGroup label="세부 설정">
          {row('budget')}
          {row('window')}
          {row('batch')}
        </SettingGroup>
      </Disclosure>
    </>
  );
}
