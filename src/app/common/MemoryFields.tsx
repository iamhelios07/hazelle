import { useState } from 'react';
import type { MemorySettings } from '../../model/memory';
import { typedText } from './typed';
import { Disclosure, NumberInput, SettingGroup, SettingRow, Switch } from '../ui';

type Count = 'budget' | 'window' | 'batch';

const COUNTS = {
  budget: { label: '기록 최대 분량', unit: '토큰', help: '정리한 기록을 요청마다 이만큼까지 넣어요.' },
  window: { label: '원문으로 보낼 최근 대화', unit: '토큰', help: undefined },
  batch: { label: '한 번에 정리할 분량', unit: '토큰', help: '오래된 대화가 이만큼 쌓이면 기록으로 정리해요.' },
} satisfies Record<Count, { label: string; unit: string; help: string | undefined }>;

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
        error={invalid ? '1 이상의 정수를 입력해 주세요.' : undefined}
        control={<NumberInput label={label} unit={unit} value={draft} invalid={invalid} onChange={type} />}
      />
    );
  };
  return (
    <>
      <SettingGroup label="장기 기억">
        <SettingRow
          label="사용"
          help="오래된 대화를 기록으로 정리해서 모델에게 보내요."
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
