import { useState } from 'react';
import { RETRIES } from '../../connectors/registry';
import { RETRY_MOST } from '../../contracts/streams';
import type { UsageNoticeKind } from '../../model/settings';
import { ANSWER_INSTRUCTION, answerInstructionOf, LORE_BUDGET, loreBudgetOf, setAnswerInstruction, setLoreBudget, setUsageNotices } from '../../runtime/chat-context';
import { setSharedRetries } from '../../runtime/connections';
import { availableFeatures } from '../../runtime/features';
import { USAGE_NOTICE_NAMES } from '../common/calls';
import { DetailFold } from '../common/DetailFold';
import { filled, typedText, useTypedNumber } from '../common/typed';
import { count, readCount } from '../common/typedNumber';
import { useAutosave } from '../common/useAutosave';
import { ANSWER_INSTRUCTION_LABEL, LORE_BUDGET_LABEL, MODEL_SETTINGS, RETRY_COUNT, RETRY_HELP } from '../common/words';
import { useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { Checkbox, NumberInput, SettingRow, Stack, Stepper, Switch, TextField } from '../ui';

export function ChatDetailDefaults() {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const { retries, loreBudget, answerInstruction, usageNotices } = settings;
  const save = useAutosave<{ loreBudget: number }>('lore-budget', (patch) => setLoreBudget(store, patch.loreBudget!));
  const budget = useTypedNumber(readCount, save.unsaved.loreBudget ?? loreBudgetOf(store), { error: '1 이상의 정수를 입력해 주세요.', onChange: (value) => save.change({ loreBudget: value }) });
  return (
    <DetailFold set={[retries, loreBudget, answerInstruction, usageNotices].filter((value) => value !== undefined).length}>
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
        help={`켜 둔 로어북 항목을 요청마다 이만큼까지 넣어요. 넘치는 항목은 빠지고, 빠지면 알려 드려요. 기본값은 ${count(LORE_BUDGET)} 토큰이에요.`}
        changed={loreBudget !== undefined}
        error={budget.error}
        control={<NumberInput label={LORE_BUDGET_LABEL} unit="토큰" value={budget.text} invalid={budget.error !== undefined} onChange={budget.change} />}
      />
      <AnswerInstructionField changed={answerInstruction !== undefined} />
      <UsageNoticesRows kinds={usageNotices} shown={['reply', ...availableFeatures(settings), 'script', 'embedding']} />
    </DetailFold>
  );
}

function AnswerInstructionField({ changed }: { changed: boolean }) {
  const store = useStore();
  const save = useAutosave<{ text: string }>('answer-instruction', (patch) => setAnswerInstruction(store, patch.text!));
  const [typed, setTyped] = useState<string>();
  const draft = typedText(typed, filled, save.unsaved.text ?? answerInstructionOf(store), (text) => text);
  const type = (next: string) => {
    setTyped(next);
    const text = filled(next);
    if (text !== null) save.change({ text });
  };
  return (
    <SettingRow
      label={ANSWER_INSTRUCTION_LABEL}
      help={`입력 없이 보내면 봇의 메시지 뒤에 이 문장을 붙여 다음 응답을 받아요. 채팅에는 남지 않아요. 기본값은 ${ANSWER_INSTRUCTION}이에요.`}
      changed={changed}
      error={filled(draft) === null ? '문장을 입력해 주세요.' : undefined}
      wide
      control={<TextField label={ANSWER_INSTRUCTION_LABEL} showLabel={false} lines={2} value={draft} onChange={type} />}
    />
  );
}

// A kind kept from an experiment since switched off is dropped by the next change, so no hidden box keeps the switch on.
function UsageNoticesRows({ kinds, shown }: { kinds: UsageNoticeKind[] | undefined; shown: UsageNoticeKind[] }) {
  const store = useStore();
  const toast = useToast();
  const save = (next: UsageNoticeKind[]) => void setUsageNotices(store, next.filter((kind) => shown.includes(kind))).then((result) => result.ok || toast.failed(result));
  return (
    <>
      <SettingRow
        label={USAGE_NOTICES}
        help="모델 요청이 끝날 때마다 입력·출력 토큰과 비용을 잠깐 띄워요."
        changed={kinds !== undefined}
        control={<Switch label={USAGE_NOTICES} checked={kinds !== undefined} onChange={(on) => save(on ? ['reply'] : [])} />}
      />
      {kinds && (
        <SettingRow
          label="알릴 요청"
          wide
          control={
            <Stack gap="related">
              {shown.map((kind) => (
                <Checkbox key={kind} label={USAGE_NOTICE_NAMES[kind]} checked={kinds.includes(kind)} onChange={(on) => save(on ? [...kinds, kind] : kinds.filter((held) => held !== kind))} />
              ))}
            </Stack>
          }
        />
      )}
    </>
  );
}

const USAGE_NOTICES = '사용량 알림';
