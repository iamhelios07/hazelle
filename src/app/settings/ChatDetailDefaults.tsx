import { useState } from 'react';
import { RETRIES } from '../../connectors/registry';
import { RETRY_MOST } from '../../contracts/streams';
import { LORE_BUDGET, loreBudgetOf, setLoreBudget } from '../../runtime/chat-context';
import { setSharedRetries } from '../../runtime/connections';
import { typedText } from '../common/typed';
import { count, readTyped } from '../common/typedNumber';
import { useAutosave } from '../common/useAutosave';
import { detailLabel, LORE_BUDGET_LABEL, MODEL_SETTINGS, RETRY_COUNT, RETRY_HELP } from '../common/words';
import { useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { Disclosure, NumberInput, SettingGroup, SettingRow, Stepper } from '../ui';

const readBudget = (draft: string) => {
  const typed = readTyped(draft, true);
  return typed.ok && typed.value >= 1 ? typed.value : null;
};

export function ChatDetailDefaults() {
  const store = useStore();
  const toast = useToast();
  const { retries, loreBudget } = useSettings();
  const save = useAutosave<{ loreBudget: number }>('lore-budget', (patch) => setLoreBudget(store, patch.loreBudget!));
  const [typed, setTyped] = useState<string>();
  const budget = save.unsaved.loreBudget ?? loreBudgetOf(store);
  const draft = typedText(typed, readBudget, budget, String);
  const invalid = readBudget(draft) === null;
  const type = (next: string) => {
    setTyped(next);
    const value = readBudget(next);
    if (value !== null) save.change({ loreBudget: value });
  };
  return (
    <Disclosure label={detailLabel([retries, loreBudget].filter((value) => value !== undefined).length)}>
      <SettingGroup label="세부 설정">
        <SettingRow
          label={RETRY_COUNT}
          help={`${RETRY_HELP} API 연결이나 ${MODEL_SETTINGS}마다 따로 정할 수도 있어요.`}
          changed={retries !== undefined}
          control={
            <Stepper
              label={RETRY_COUNT}
              less="한 번 덜 보내기"
              more="한 번 더 보내기"
              value={retries ?? RETRIES}
              min={0}
              max={RETRY_MOST}
              onChange={(next) => void setSharedRetries(store, next).then((result) => result.ok || toast.failed(result))}
            />
          }
        />
        <SettingRow
          label={LORE_BUDGET_LABEL}
          help={`켜진 로어북 항목을 요청마다 이만큼까지 넣어요. 넘치는 항목은 빠지고, 빠지면 알려 드려요. 기본은 ${count(LORE_BUDGET)} 토큰이에요.`}
          changed={loreBudget !== undefined}
          error={invalid ? '1 이상의 정수를 입력해 주세요.' : undefined}
          control={<NumberInput label={LORE_BUDGET_LABEL} unit="토큰" value={draft} invalid={invalid} onChange={type} />}
        />
      </SettingGroup>
    </Disclosure>
  );
}
