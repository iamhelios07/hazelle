import { useEffect, useRef, useState, type ReactNode } from 'react';
import { modelSettings } from '../../connectors/registry';
import { problems, type Accepts, type Bounds, type ModelSettings, type NumberSetting, type Reasoning, type SettingsSchema } from '../../connectors/settings';
import type { Starred } from '../../connectors/types';
import type { Stored } from '../../model/kinds';
import type { ApiResult } from '../../runtime/api';
import { clearModelSetting, clearModelSettings, setModelSettings } from '../../runtime/connections';
import { useStore } from '../session';
import { navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Callout, ChoiceGroup, Disclosure, NavBar, NumberInput, PageHead, PhraseField, Row, Screen, Section, SettingGroup, SettingRow, Text, usePane } from '../ui';
import { clamp, count, readTyped, type Typed } from './typedNumber';

// How long typing pauses before a number is saved.
const PAUSE = 600;

type Status = 'saving' | 'saved' | 'failed';
const STATUS: Record<Status, string> = { saving: '저장 중', saved: '저장됨', failed: '저장 못 함' };

// An unset value is never shown as a number (design §4.4).
const UNSET = '보내지 않음 · 제공자 기본값';
const UNKNOWN = '받는지 알 수 없어요';
const REFUSED = '이 모델은 받지 않아요. 비워야 보낼 수 있어요.';

// start: what 정하기 writes, before the schema's bounds clamp it.
const NUMBER: Record<NumberSetting, { label: string; help: string; start: number }> = {
  maxOutput: { label: '답장 최대 길이', help: '한 번의 답장에 쓸 수 있는 최대 토큰', start: 4000 },
  temperature: { label: '온도', help: '높을수록 답이 들쭉날쭉해져요', start: 1 },
  topP: { label: 'top_p', help: '확률 높은 후보부터 이 비율만큼만 골라요', start: 1 },
  topK: { label: 'top_k', help: '후보를 이 개수만큼만 봐요', start: 40 },
  minP: { label: 'min_p', help: '가장 그럴듯한 후보에 비해 이 비율보다 낮은 후보는 버려요', start: 0.05 },
  frequencyPenalty: { label: '빈도 억제', help: '자주 나온 말일수록 덜 써요', start: 0 },
  presencePenalty: { label: '존재 억제', help: '한 번이라도 나온 말을 덜 써요', start: 0 },
  repetitionPenalty: { label: '반복 억제', help: '1보다 크면 같은 말을 덜 되풀이해요', start: 1.05 },
  seed: { label: 'seed', help: '같은 값이면 같은 조건에서 비슷한 답이 나와요', start: 1 },
};
const GENERATION: NumberSetting[] = ['temperature', 'topP', 'topK', 'minP', 'frequencyPenalty', 'presencePenalty', 'repetitionPenalty', 'seed'];
const STOP = { label: '멈춤 문구', help: '이 글이 나오면 답장을 거기서 끝내요' };
// Used when the catalog does not say how long the model's context is.
const CONTEXT_START = 8192;
const BUDGET_START = 8000;

const LEVELS: Partial<Record<string, string>> = { minimal: '최소', low: '낮음', medium: '보통', high: '높음', xhigh: '매우 높음', max: '최대' };

type Choice = 'off' | 'adaptive' | 'budget' | `level:${string}`;
const choiceOf = (reasoning: Reasoning): Choice => (reasoning.kind === 'level' ? `level:${reasoning.level}` : reasoning.kind);

// Each typed field keeps what was typed until it is cleared, so a half-typed value is never replaced.
type Field = NumberSetting | 'context' | 'budget';
// accepted false: the setting sits in its section's fold, 이 모델은 안 받아요.
type Line = { label: string; accepted: Accepts; row: ReactNode };

const help = (text: string, accepted: Accepts) => (accepted === null ? `${text} · ${UNKNOWN}` : text);
function omit<T extends object>(from: T, key: PropertyKey): T {
  const rest = { ...from };
  delete rest[key as keyof T];
  return rest;
}

export function ModelSettingsScreen({ stored, model, back }: { stored: Stored<'connection'>; model: Starred; back: Back }) {
  const store = useStore();
  const toast = useToast();
  const pane = usePane();
  const schema = modelSettings(stored.value, model);
  // Writes wait for the server, so what they will leave shows at once and the stored copy takes over once none is left.
  const [local, setLocal] = useState<ModelSettings | null>(null);
  const [drafts, setDrafts] = useState<Partial<Record<Field, string>>>({});
  const [status, setStatus] = useState<Status | null>(null);
  // 정하기 on 멈춤 문구 opens its field; nothing is saved until a phrase is added.
  const [stopOpen, setStopOpen] = useState(false);
  const writes = useRef(0);
  const waiting = useRef<ModelSettings>({});
  const timer = useRef<number | undefined>(undefined);
  const shown = local ?? model.settings ?? {};
  const latest = useRef(shown);
  latest.current = shown;

  async function write(next: ModelSettings, run: () => Promise<ApiResult<unknown>>) {
    setLocal(next);
    setStatus('saving');
    writes.current++;
    const result = await run();
    writes.current--;
    if (!result.ok) {
      setLocal(null);
      setStatus('failed');
      toast.failed(result, '저장하지 못했어요.');
    } else if (writes.current === 0) {
      setLocal(null);
      setStatus('saved');
    }
    return result.ok;
  }

  const set = (values: ModelSettings) => write({ ...latest.current, ...values }, () => setModelSettings(store, stored.id, model.id, values));

  function flush() {
    window.clearTimeout(timer.current);
    const patch = waiting.current;
    if (Object.keys(patch).length === 0) return;
    waiting.current = {};
    void set(patch);
  }
  const leave = useRef(flush);
  leave.current = flush;
  useEffect(() => () => leave.current(), []);

  function forget(key: keyof ModelSettings, field?: Field) {
    waiting.current = omit(waiting.current, key);
    if (field) setDrafts((current) => omit(current, field));
  }

  function clear(key: keyof ModelSettings, field?: Field) {
    forget(key, field);
    void write(omit(latest.current, key), () => clearModelSetting(store, stored.id, model.id, key));
  }

  // An invalid draft shows its error and is never saved, and takes back a valid one still waiting.
  function type(field: Field, key: keyof ModelSettings, draft: string, typed: Typed, value: (number: number) => ModelSettings) {
    setDrafts((current) => ({ ...current, [field]: draft }));
    waiting.current = typed.ok ? { ...waiting.current, ...value(typed.value) } : omit(waiting.current, key);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, PAUSE);
  }

  async function resetAll() {
    window.clearTimeout(timer.current);
    const previous = { ...latest.current, ...waiting.current };
    waiting.current = {};
    setDrafts({});
    setStopOpen(false);
    if (await write({}, () => clearModelSettings(store, stored.id, model.id))) {
      toast.undoable(`${model.name}의 설정을 모두 기본값으로 돌렸어요.`, () => void setModelSettings(store, stored.id, model.id, previous));
    }
  }

  const unset = (text: string, onSet: () => void) => (
    <>
      <Text size="sm" tone="muted">
        {text}
      </Text>
      <Button variant="secondary" size="sm" onClick={onSet}>
        정하기
      </Button>
    </>
  );
  const emptyButton = (onClick: () => void) => (
    <Button variant="ghost" size="sm" onClick={onClick}>
      비우기
    </Button>
  );

  type NumberRow = { field: NumberSetting | 'context'; label: string; text: string; rule: Bounds & { whole: boolean }; fits: (value: number) => boolean; capped: boolean; unit?: string; unsetText: string; start: number };
  function numberRow({ field, label, text, rule, fits, capped, unit, unsetText, start }: NumberRow): ReactNode {
    const value = shown[field];
    const draft = drafts[field];
    if (value === undefined && draft === undefined) {
      const first = clamp(start, rule);
      return (
        <SettingRow
          key={field}
          label={label}
          help={text}
          control={unset(unsetText, () => {
            setDrafts((current) => ({ ...current, [field]: String(first) }));
            void set({ [field]: first });
          })}
        />
      );
    }
    const typed = readTyped(draft ?? String(value), rule, fits, capped);
    return (
      <SettingRow
        key={field}
        label={label}
        help={text}
        error={typed.ok ? undefined : typed.error}
        control={
          <>
            <NumberInput label={label} value={draft ?? String(value)} unit={unit} invalid={!typed.ok} onChange={(next) => type(field, field, next, readTyped(next, rule, fits, capped), (number) => ({ [field]: number }))} />
            {emptyButton(() => clear(field, field))}
          </>
        }
      />
    );
  }

  // A value stored for a setting the model does not take stays visible in the fold, so it can be cleared.
  const refusedRow = (key: keyof ModelSettings, label: string, value: string, field?: Field) => (
    <SettingRow
      key={key}
      label={label}
      error={REFUSED}
      control={
        <>
          <Text size="sm" tone="muted">
            {value}
          </Text>
          {emptyButton(() => clear(key, field))}
        </>
      }
    />
  );

  function schemaNumber(name: NumberSetting, text: string): Line {
    const rule = schema!.numbers[name];
    const { label, start } = NUMBER[name];
    const value = shown[name];
    if (rule.accepted === false) return { label, accepted: false, row: value === undefined ? null : refusedRow(name, label, String(value), name) };
    const row = numberRow({
      field: name,
      label,
      text: help(text, rule.accepted),
      rule,
      fits: (number) => problems(schema!, { [name]: number }).length === 0,
      capped: name === 'maxOutput',
      unit: name === 'maxOutput' ? '토큰' : undefined,
      unsetText: UNSET,
      start,
    });
    return { label, accepted: rule.accepted, row };
  }

  function stopLine(accepts: Accepts): Line {
    const phrases = shown.stop ?? [];
    if (accepts === false) return { label: STOP.label, accepted: false, row: phrases.length ? refusedRow('stop', STOP.label, phrases.join(', ')) : null };
    const open = phrases.length > 0 || stopOpen;
    const change = (next: string[]) => {
      if (next.length) return void set({ stop: next });
      setStopOpen(false);
      clear('stop');
    };
    const row = (
      <SettingRow
        key="stop"
        label={STOP.label}
        help={help(STOP.help, accepts)}
        control={
          open ? (
            <>
              <PhraseField label={STOP.label} phrases={phrases} onChange={change} />
              {emptyButton(() => change([]))}
            </>
          ) : (
            unset(UNSET, () => setStopOpen(true))
          )
        }
      />
    );
    return { label: STOP.label, accepted: accepts, row };
  }

  function reasoningRow(rules: SettingsSchema['reasoning']): ReactNode {
    const reasoning = shown.reasoning;
    // This screen writes adaptive without a level, but one stored elsewhere with a level still names it,
    // so picking another choice never drops it unseen.
    const adaptive = reasoning?.kind === 'adaptive' && reasoning.level !== null ? `적응형 · ${LEVELS[reasoning.level] ?? reasoning.level}` : '적응형';
    const options: { value: Choice; label: string }[] = [
      ...(rules.off !== false ? [{ value: 'off' as const, label: '끔' }] : []),
      ...(rules.adaptive !== false ? [{ value: 'adaptive' as const, label: adaptive }] : []),
      ...(rules.level !== false ? rules.levels.map((level) => ({ value: `level:${level}` as const, label: LEVELS[level] ?? level })) : []),
      ...(rules.budget.accepted !== false ? [{ value: 'budget' as const, label: '예산' }] : []),
    ];
    const refused = reasoning && problems(schema!, { reasoning }).some((problem) => problem.problem === 'not-accepted');
    const [head] = options;
    if (!head) {
      return (
        <SettingRow
          key="reasoning"
          label="생각"
          error={refused ? REFUSED : undefined}
          control={
            <>
              <Text size="sm" tone="muted">
                이 모델은 생각 설정이 없어요
              </Text>
              {reasoning && emptyButton(() => clear('reasoning', 'budget'))}
            </>
          }
        />
      );
    }
    const onlyAdaptive = options.length === 1 && head.value === 'adaptive';
    const unknown = [rules.off, rules.adaptive, rules.level, rules.budget.accepted].some((accepted) => accepted === null);
    const text = help(onlyAdaptive ? '모델이 필요한 만큼 생각해요.' : '답하기 전에 얼마나 생각할지 정해요.', unknown ? null : true);
    const label = onlyAdaptive ? '생각 · 적응형' : '생각';
    const budgetTokens = (tokens: number): ModelSettings => ({ reasoning: { kind: 'budget', tokens } });
    const pick = (choice: Choice) => {
      forget('reasoning', 'budget');
      if (choice === 'budget') return void set(budgetTokens(reasoning?.kind === 'budget' ? reasoning.tokens : clamp(BUDGET_START, rules.budget)));
      const next: Reasoning = choice === 'off' ? { kind: 'off' } : choice === 'adaptive' ? { kind: 'adaptive', level: null } : { kind: 'level', level: choice.slice('level:'.length) };
      void set({ reasoning: next });
    };
    if (!reasoning) {
      const first = options.find((option) => option.value.startsWith('level:')) ?? options.find((option) => option.value === 'adaptive') ?? options.find((option) => option.value === 'budget') ?? head;
      return <SettingRow key="reasoning" label={label} help={text} control={unset(UNSET, () => pick(first.value))} />;
    }
    const choice = choiceOf(reasoning);
    const budget = reasoning.kind === 'budget' && rules.budget.accepted !== false;
    const draft = drafts.budget ?? (reasoning.kind === 'budget' ? String(reasoning.tokens) : '');
    const fits = (tokens: number) => problems(schema!, budgetTokens(tokens)).length === 0;
    const typed = budget ? readTyped(draft, rules.budget, fits) : null;
    const error = typed && !typed.ok ? typed.error : problems(schema!, { reasoning }).length ? '이 모델이 받지 않는 생각 설정이에요. 다시 고르거나 비워 주세요.' : undefined;
    return (
      <SettingRow
        key="reasoning"
        label={label}
        help={text}
        error={error}
        control={
          <>
            <ChoiceGroup layout="segmented" label={label} options={options} value={options.some((option) => option.value === choice) ? choice : null} onChange={pick} />
            {budget && <NumberInput label="생각 예산" unit="토큰" value={draft} invalid={!typed?.ok} onChange={(next) => type('budget', 'reasoning', next, readTyped(next, rules.budget, fits), budgetTokens)} />}
            {emptyButton(() => clear('reasoning', 'budget'))}
          </>
        }
      />
    );
  }

  function section(title: string, lines: Line[]) {
    const taken = lines.filter((line) => line.accepted !== false);
    const refused = lines.filter((line) => line.accepted === false);
    const kept = refused.map((line) => line.row).filter(Boolean);
    return (
      <Section title={title}>
        {taken.length > 0 && <SettingGroup label={title}>{taken.map((line) => line.row)}</SettingGroup>}
        {refused.length > 0 && (
          <Disclosure label={`이 모델은 안 받아요 · ${refused.length}개`}>
            <p>{`${refused.map((line) => line.label).join(', ')} · 보내면 제공자가 거절하거나 무시해서 여기서 뺐어요.`}</p>
            {kept.length > 0 && <SettingGroup label={`${title} · 안 받는 값`}>{kept}</SettingGroup>}
          </Disclosure>
        )}
      </Section>
    );
  }

  const nothingSet = Object.keys(shown).length === 0;
  const top = (
    <NavBar
      named
      title={model.name}
      backLabel={stored.value.label}
      onBack={() => navigate(back.to)}
      actions={
        <Row kind="actions">
          {status && (
            <Text size="sm" tone="muted">
              {STATUS[status]}
            </Text>
          )}
          <Button variant="secondary" size="sm" disabled={nothingSet} onClick={() => void resetAll()}>
            모두 기본값으로
          </Button>
        </Row>
      }
    />
  );

  if (!schema) {
    return (
      <Screen width="form" top={top}>
        <PageHead title={pane === 'detail' ? model.name : undefined} code={model.id} />
        <Callout tone="warn">이 버전은 이 모델을 부를 수 없어서 정할 설정이 없어요.</Callout>
      </Screen>
    );
  }

  const maxOutput = schema.numbers.maxOutput.max;
  const limit = model.contextLength;
  const context = numberRow({
    field: 'context',
    label: '컨텍스트 한도',
    text: `대화가 이보다 길면 오래된 메시지부터 덜어 내요${limit === null ? '' : ` · 이 모델 최대 ${count(limit)}`}`,
    rule: { min: 1, max: limit, whole: true },
    // Never sent, so problems() leaves it out: the prompt's own limit is checked against the catalog's here.
    fits: (value) => Number.isSafeInteger(value) && value >= 1 && (limit === null || value <= limit),
    capped: true,
    unit: '토큰',
    unsetText: `모델 한도까지 · ${limit === null ? '알 수 없음' : count(limit)}`,
    start: limit ?? CONTEXT_START,
  });
  const prefill = { true: '받아요', false: '받지 않아요', null: '알 수 없어요' }[String(schema.prefill) as 'true' | 'false' | 'null'];

  return (
    <Screen width="form" top={top}>
      <PageHead title={pane === 'detail' ? model.name : undefined} code={model.id}>
        비워 둔 값은 보내지 않아요. 그때는 제공자 기본값이 쓰여요. 이 모델이 받는 값만 보여요.
      </PageHead>
      {section('길이', [
        schemaNumber('maxOutput', `${NUMBER.maxOutput.help}${maxOutput === null ? '' : ` · 이 모델 최대 ${count(maxOutput)}`}`),
        { label: '컨텍스트 한도', accepted: true, row: context },
      ])}
      {section('생성', [...GENERATION.map((name) => schemaNumber(name, NUMBER[name].help)), stopLine(schema.stop)])}
      {section('추론', [{ label: '생각', accepted: true, row: reasoningRow(schema.reasoning) }])}
      {section('기타', [
        {
          label: '시스템 메시지 보내는 방식',
          accepted: true,
          row: (
            <SettingRow
              key="system"
              label="시스템 메시지 보내는 방식"
              help="시스템 메시지를 따로 받지 않는 모델이면 사용자 메시지로 바꿔 보내요."
              control={
                <ChoiceGroup
                  layout="segmented"
                  label="시스템 메시지 보내는 방식"
                  options={[
                    { value: 'as-is', label: '그대로' },
                    { value: 'user', label: '사용자 메시지로' },
                  ]}
                  value={shown.systemAsUser ? 'user' : 'as-is'}
                  onChange={(value) => (value === 'user' ? void set({ systemAsUser: true }) : clear('systemAsUser'))}
                />
              }
            />
          ),
        },
        {
          label: '답장 첫머리 채우기',
          accepted: true,
          row: (
            <SettingRow
              key="prefill"
              label="답장 첫머리 채우기"
              help="프롬프트 끝의 AI 글을 답장의 시작으로 이어 쓰는지예요. 모델 목록이 알려 준 사실이에요."
              control={
                <Text size="sm" tone="muted">
                  {prefill}
                </Text>
              }
            />
          ),
        },
      ])}
    </Screen>
  );
}
