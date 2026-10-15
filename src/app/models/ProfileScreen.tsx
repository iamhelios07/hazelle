import { useState, type ReactNode } from 'react';
import { modelSettings } from '../../connectors/registry';
import { fit, SERVICE_TIERS, VERBOSITY, WHOLE, type Change, type ModelSettings, type Reasoning, type SettingsSchema } from '../../connectors/settings';
import type { Stored } from '../../model/kinds';
import {
  addProfile,
  modelProfile,
  profileUsers,
  removeProfile,
  renameProfile,
  restoreProfile,
  setDefaultProfile,
  setModelProfile,
  setProfileSettings,
  withSettings,
  type ProfileUser,
} from '../../runtime/profiles';
import { ACTS, addOf } from '../common/acts';
import { choices } from '../common/reading';
import { RetriesRow } from '../common/RetriesRow';
import { typedText } from '../common/typed';
import { useSearch } from '../common/useSearch';
import { SAVE_STATUS, useAutosave } from '../common/useAutosave';
import { BIN_KEEPS, defaultMark, detailLabel, DISCOUNT, MODEL_SETTINGS, RESET, UNSET } from '../common/words';
import { useConnections, useProfiles, useSettings, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, ChoiceGroup, Disclosure, Empty, List, ListItem, Menu, MenuHeading, MenuItem, NavBar, NumberInput, PhraseField, Screen, Section, SettingGroup, SettingRow, Stack, Switch, Tag } from '../ui';
import { CACHE, changeLine, changeWords, DETAIL, LEVELS, levelName, MAIN, NOT_CALLABLE, NUMBER, SERVICE_TIER_LABEL, SERVICE_TIER_WORDS, VERBOSITY_LABEL, VERBOSITY_WORDS, type Field } from './settingWords';
import { count, readOptional, readTyped } from '../common/typedNumber';

const whole = (field: Field | 'budget') => field === 'budget' || field === 'context' || WHOLE.has(field);
// undefined: left empty, which unsets it. null: not a number the field takes.
const readNumber = (text: string, field: Field | 'budget') => readOptional(text, whole(field));
const BUDGET_START = 8000;

type Choice = 'unset' | 'off' | 'adaptive' | 'budget' | `level:${string}`;
const choiceOf = (reasoning: Reasoning | undefined): Choice => (!reasoning ? 'unset' : reasoning.kind === 'level' ? `level:${reasoning.level}` : reasoning.kind);

// schema null: this version cannot call it.
type User = ProfileUser & { schema: SettingsSchema | null; changes: Change[] };

// The name rides in the settings' patch, so one queue orders both writes.
type Saved = ModelSettings & { name: string };
const split = ({ name, ...settings }: Partial<Saved>): { name?: string; settings: ModelSettings } => ({ name, settings });

export function ProfileScreen({ stored, back }: { stored: Stored<'profile'>; back: Back }) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const connections = useConnections();
  // modelProfile reads the store directly; profile edits must still refresh the attach-menu labels.
  useProfiles();
  const { id } = stored;
  const isDefault = settings.profile === id;

  const [drafts, setDrafts] = useState<Partial<Record<Field | 'budget' | 'name', string>>>({});
  const { status, unsaved, change, save, flush, remove: removing } = useAutosave<Saved>(`profile:${id}`, async (patch) => {
    const { name: renamed, settings: values } = split(patch);
    if (renamed !== undefined) {
      const done = await renameProfile(store, id, renamed);
      if (!done.ok) return done;
    }
    return Object.keys(values).length ? setProfileSettings(store, id, values) : { ok: true };
  });
  const shown = withSettings(stored.value.settings, split(unsaved).settings);
  const name = typedText(drafts.name, (typed) => typed.trim() || null, unsaved.name ?? stored.value.name, String);
  const set = (values: ModelSettings) => void save(values);

  function type(field: Field | 'budget', draft: string, value: (number: number) => ModelSettings) {
    setDrafts((current) => ({ ...current, [field]: draft }));
    const key = field === 'budget' ? 'reasoning' : field;
    const typed = readTyped(draft, whole(field));
    if (draft.trim() === '' && field !== 'budget') change({ [key]: undefined });
    else change(typed.ok ? value(typed.value) : { [key]: undefined }, typed.ok);
  }

  function rename(next: string) {
    setDrafts((current) => ({ ...current, name: next }));
    change({ name: next.trim() }, !!next.trim());
  }

  const users: User[] = profileUsers(connections, settings.profile, id).map((user) => {
    const schema = modelSettings(user.connection.value, user.model);
    return { ...user, schema, changes: schema ? fit(schema, shown).changes : [] };
  });
  const callable = users.filter((user): user is User & { schema: SettingsSchema } => user.schema !== null);

  function noteFor(setting: Change['setting']): string | undefined {
    const left = users.filter((user) => user.changes.some((change) => change.setting === setting && change.change === 'left-out')).map((user) => user.model.name);
    const capped = users.flatMap((user) => user.changes.flatMap((change) => (change.setting === setting && change.change === 'capped' ? [`${user.model.name} ${count(change.to)}`] : [])));
    return changeLine(left, capped);
  }

  function numberRow(field: Field): ReactNode {
    const { label, help, unit, unset } = NUMBER[field];
    const value = shown[field];
    const draft = typedText(drafts[field], (text) => readNumber(text, field), value, (number) => (number === undefined ? '' : String(number)));
    const typed = draft.trim() === '' ? null : readTyped(draft, whole(field));
    return (
      <SettingRow
        key={field}
        label={label}
        help={help}
        changed={value !== undefined}
        error={typed && !typed.ok ? typed.error : undefined}
        note={noteFor(field)}
        control={<NumberInput label={label} value={draft} unit={unit} placeholder={unset ?? UNSET} invalid={typed?.ok === false} onChange={(next) => type(field, next, (number) => ({ [field]: number }))} />}
      />
    );
  }

  function reasoningRow(): ReactNode {
    const reasoning = shown.reasoning;
    const current = choiceOf(reasoning);
    const offers = (takes: (rules: SettingsSchema['reasoning']) => boolean) => callable.length === 0 || callable.some((user) => takes(user.schema.reasoning));
    const named = callable.length === 0 ? Object.keys(LEVELS) : [...new Set(callable.flatMap((user) => (user.schema.reasoning.level === false ? [] : user.schema.reasoning.levels)))];
    const known = Object.keys(LEVELS);
    const levels = [...known.filter((level) => named.includes(level)), ...named.filter((level) => !known.includes(level))];
    // One stored elsewhere with a level still names it, so picking another choice never drops it unseen.
    const adaptive = reasoning?.kind === 'adaptive' && reasoning.level !== null ? `적응형 · ${levelName(reasoning.level)}` : '적응형';
    const options: { value: Choice; label: string }[] = [
      { value: 'unset', label: UNSET },
      ...(offers((rules) => rules.off !== false) ? [{ value: 'off' as const, label: '끔' }] : []),
      ...(offers((rules) => rules.adaptive !== false) ? [{ value: 'adaptive' as const, label: adaptive }] : []),
      ...levels.map((level) => ({ value: `level:${level}` as const, label: levelName(level) })),
      ...(offers((rules) => rules.budget.accepted !== false) ? [{ value: 'budget' as const, label: '예산' }] : []),
    ];
    if (!options.some((option) => option.value === current)) options.push({ value: current, label: current === 'adaptive' ? adaptive : current.startsWith('level:') ? levelName(current.slice(6)) : current });

    const pick = (choice: Choice) => {
      setDrafts((drafted) => ({ ...drafted, budget: undefined }));
      if (choice === 'budget') return set({ reasoning: { kind: 'budget', tokens: reasoning?.kind === 'budget' ? reasoning.tokens : BUDGET_START } });
      const next: Reasoning | undefined =
        choice === 'unset' ? undefined : choice === 'off' ? { kind: 'off' } : choice === 'adaptive' ? { kind: 'adaptive', level: null } : { kind: 'level', level: choice.slice('level:'.length) };
      set({ reasoning: next });
    };
    const draft = typedText(drafts.budget, (text) => readNumber(text, 'budget') ?? null, reasoning?.kind === 'budget' ? reasoning.tokens : undefined, (tokens) => (tokens === undefined ? '' : String(tokens)));
    const typed = reasoning?.kind === 'budget' ? readTyped(draft, true) : null;
    return (
      <SettingRow
        key="reasoning"
        label="추론"
        changed={reasoning !== undefined}
        error={typed && !typed.ok ? typed.error : undefined}
        note={noteFor('reasoning')}
        wide
        control={
          <Stack gap="related">
            <ChoiceGroup layout="fit" label="추론" options={options} value={current} onChange={pick} />
            {reasoning?.kind === 'budget' && (
              <NumberInput label="추론 예산" unit="토큰" value={draft} invalid={!typed?.ok} onChange={(next) => type('budget', next, (tokens) => ({ reasoning: { kind: 'budget', tokens } }))} />
            )}
          </Stack>
        }
      />
    );
  }

  // Shown where a model on this 설정 can be sent it, or while a value is set, so a stored one is never hidden.
  function choiceRow<V extends string>(setting: 'verbosity' | 'serviceTier', label: string, help: string, values: readonly V[], words: Record<V, string>, value: V | undefined, pick: (value: V | undefined) => ModelSettings): ReactNode {
    if (value === undefined && callable.length > 0 && callable.every((user) => user.schema[setting] === false)) return null;
    return (
      <SettingRow
        key={setting}
        label={label}
        help={help}
        changed={value !== undefined}
        note={noteFor(setting)}
        control={
          <ChoiceGroup<V | 'unset'>
            layout="segmented"
            label={label}
            options={[{ value: 'unset', label: UNSET }, ...values.map((choice) => ({ value: choice, label: words[choice] }))]}
            value={value ?? 'unset'}
            onChange={(next) => set(pick(next === 'unset' ? undefined : next))}
          />
        }
      />
    );
  }

  const cacheRow = (
    <SettingRow
      key="cache"
      label="캐시"
      help="보낸 앞부분을 저장해 다음 요청에서 저렴하게 읽어요. 저장할 때는 요금이 더 들어요"
      changed={shown.cache !== undefined}
      note={noteFor('cache')}
      control={
        <ChoiceGroup
          layout="segmented"
          label="캐시"
          options={[{ value: 'off' as const, label: '끔' }, ...choices(CACHE)]}
          value={shown.cache ?? 'off'}
          onChange={(value) => set({ cache: value === 'off' ? undefined : value })}
        />
      }
    />
  );

  // Shown only where a model on this 설정 has a discount lane, or while it is set, so a stored one is never hidden.
  const discountRow = (shown.discount || callable.some((user) => user.schema.discount !== false)) && (
    <SettingRow
      key="discount"
      label={DISCOUNT}
      help="요금이 절반이 되는 대신 응답이 느려질 수 있어요. 연결에 따라 답을 한 번에 받기도 하고, 그때는 번역 같은 보조 작업에 할인이 적용되지 않아요"
      changed={shown.discount !== undefined}
      note={noteFor('discount')}
      control={<Switch label={DISCOUNT} checked={shown.discount === true} onChange={(on) => set({ discount: on ? true : undefined })} />}
    />
  );

  const stopRow = (
    <SettingRow
      key="stop"
      label="멈춤 문구"
      help="이 문구가 나오면 응답을 끝내요"
      changed={shown.stop !== undefined}
      note={noteFor('stop')}
      control={<PhraseField label="멈춤 문구" phrases={shown.stop ?? []} onChange={(next) => set({ stop: next.length ? next : undefined })} />}
    />
  );

  const systemRow = (
    <SettingRow
      key="system"
      label="시스템 메시지 보내는 방식"
      help="시스템 메시지를 지원하지 않는 모델이면 사용자 메시지로 보내요"
      changed={shown.systemAsUser !== undefined}
      control={
        <ChoiceGroup
          layout="segmented"
          label="시스템 메시지 보내는 방식"
          options={[
            { value: 'as-is', label: '시스템 메시지로' },
            { value: 'user', label: '사용자 메시지로' },
          ]}
          value={shown.systemAsUser ? 'user' : 'as-is'}
          onChange={(value) => set({ systemAsUser: value === 'user' ? true : undefined })}
        />
      }
    />
  );

  const streamingRow = (
    <SettingRow
      key="streaming"
      label="스트리밍"
      help="프록시가 응답을 중간에 끊으면 꺼 주세요"
      changed={shown.streaming !== undefined}
      control={<Switch label="스트리밍" checked={shown.streaming !== false} onChange={(on) => set({ streaming: on ? undefined : false })} />}
    />
  );

  const summary = (user: User) => (user.schema ? changeWords(user.changes) : NOT_CALLABLE);

  const using = new Set(users.map((user) => `${user.connection.id}/${user.model.id}`));
  const profileName = (model: ProfileUser['model']) => {
    const choice = modelProfile(store, model);
    return choice.kind === 'profile' ? choice.profile.value.name : '없음';
  };
  const others = connections.map((connection) => ({ connection, models: connection.value.starred.filter((model) => !using.has(`${connection.id}/${model.id}`)) })).filter((group) => group.models.length > 0);
  // The default 묶음 is what a model without its own uses, so taking a model onto it clears the model's own.
  const attach = (connection: string, model: string) => void setModelProfile(store, connection, model, isDefault ? null : id).then((done) => done.ok || toast.failed(done, '저장하지 못했어요.'));

  async function copy() {
    if (!(await flush())) return;
    const copied = crypto.randomUUID();
    void addProfile(store, { name: `${name.trim() || stored.value.name} (사본)`, settings: shown }, copied).then((made) => made.ok || toast.failed(made, '사본을 만들지 못했어요.'));
    navigate({ kind: 'profile', id: copied });
  }

  async function clearAll() {
    const previous = shown;
    const cleared: ModelSettings = {};
    for (const key of Object.keys(shown) as (keyof ModelSettings)[]) cleared[key] = undefined;
    setDrafts({});
    if (await save(cleared)) toast.undoable(`'${stored.value.name}' 설정을 기본값으로 되돌렸어요.`, () => setProfileSettings(store, id, previous));
  }

  async function remove() {
    const removed = await removing(() => removeProfile(store, id));
    if (!removed) return;
    if (!removed.ok) {
      if (removed.error === 'default') return toast.error('기본 설정은 삭제할 수 없어요.', { detail: '다른 설정을 기본으로 지정한 뒤 삭제해 주세요.' });
      return toast.failed(removed, '삭제하지 못했어요.');
    }
    navigate({ kind: 'models' });
    const note = users.length ? `이 설정을 쓰던 모델 ${users.length}개는 다른 설정을 선택해야 사용할 수 있어요. ${BIN_KEEPS}` : BIN_KEEPS;
    toast.undoable(`'${removed.data.value.name}' 설정을 삭제했어요.`, () => restoreProfile(store, id), note);
  }

  const mark = defaultMark(isDefault, stored.value.name);
  const detailSet =
    DETAIL.filter((field) => shown[field] !== undefined).length + [shown.stop, shown.verbosity, shown.serviceTier, shown.systemAsUser, shown.streaming === false, shown.retries !== undefined].filter(Boolean).length;

  return (
    <Screen
      width="form"
      top={
        <NavBar
          title={name}
          rename={{ label: '설정 이름', placeholder: stored.value.name, onChange: rename }}
          subtitle={
            <>
              {MODEL_SETTINGS} {mark && <Tag tone="accent">{mark}</Tag>}
            </>
          }
          {...backBar(back)}
          status={status ? SAVE_STATUS[status] : undefined}
          menu={{
            of: MODEL_SETTINGS,
            items: (
              <>
                <MenuItem icon={ACTS.duplicate.icon} label={ACTS.duplicate.label} onClick={() => void copy()} />
                {!isDefault && (
                  <MenuItem
                    label="기본으로 정하기"
                    sub="설정을 선택하지 않은 모델이 이 설정을 사용해요"
                    onClick={() => void setDefaultProfile(store, id).then((done) => done.ok || toast.failed(done, '저장하지 못했어요.'))}
                  />
                )}
                <MenuItem label={RESET} disabled={Object.keys(shown).length === 0} onClick={() => void clearAll()} />
                {!isDefault && <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={() => void remove()} />}
              </>
            ),
          }}
        />
      }
    >

      <Section
        title="이 설정을 쓰는 모델"
        note={users.length ? `${users.length}개` : undefined}
        action={
          others.length > 0 && (
            <Menu
              place="below-end"
              size="lg"
              label={addOf('모델')}
              trigger={(opener) => (
                <Button variant="secondary" icon={ACTS.create.icon} {...opener}>
                  {addOf('모델')}
                </Button>
              )}
            >
              <AddChoices groups={others} now={profileName} onPick={attach} />
            </Menu>
          )
        }
      >
        {users.length > 0 ? (
          <List label="이 설정을 쓰는 모델">
            {users.map((user) => (
              <ListItem
                key={`${user.connection.id}/${user.model.id}`}
                title={user.model.name}
                tags={[user.connection.value.label]}
                description={summary(user)}
                onClick={() => navigate({ kind: 'model', connection: user.connection.id, model: user.model.id })}
              />
            ))}
          </List>
        ) : (
          <Empty variant="section">이 설정을 쓰는 모델이 없어요.</Empty>
        )}
      </Section>

      <Section title="자주 쓰는 설정">
        <SettingGroup label="자주 쓰는 설정">
          {MAIN.map(numberRow)}
          {reasoningRow()}
          {cacheRow}
          {discountRow}
        </SettingGroup>
      </Section>

      <Disclosure label={detailLabel(detailSet)}>
        <SettingGroup label="세부 설정">
          {DETAIL.map(numberRow)}
          {stopRow}
          {choiceRow('verbosity', VERBOSITY_LABEL, '간단히를 선택하면 같은 내용을 더 짧게 써요', VERBOSITY, VERBOSITY_WORDS, shown.verbosity, (verbosity) => ({ verbosity }))}
          {choiceRow('serviceTier', SERVICE_TIER_LABEL, '자동은 Anthropic 계정에 우선 처리 용량이 있으면 그 용량부터 사용해요', SERVICE_TIERS, SERVICE_TIER_WORDS, shown.serviceTier, (serviceTier) => ({ serviceTier }))}
          {systemRow}
          {streamingRow}
          <RetriesRow value={shown.retries} follows="연결 설정" onChange={(retries) => change({ retries })} />
        </SettingGroup>
      </Disclosure>
    </Screen>
  );
}

type Group = { connection: Stored<'connection'>; models: ProfileUser['model'][] };

// Mounted only while the menu is open, so each opening starts with an empty search.
function AddChoices({ groups, now, onPick }: { groups: Group[]; now: (model: Group['models'][number]) => string; onPick: (connection: string, model: string) => void }) {
  const choices = groups.flatMap(({ connection, models }) => models.map((model) => ({ connection, model })));
  const search = useSearch(choices, '모델 검색', ({ connection, model }) => [model.name, connection.value.label]);
  const shown = groups.flatMap(({ connection }) => {
    const found = search.found.filter((choice) => choice.connection === connection);
    return found.length === 0 ? [] : [
      <MenuHeading key={connection.id}>{connection.value.label}</MenuHeading>,
      ...found.map(({ model }) => <MenuItem key={`${connection.id}/${model.id}`} label={model.name} sub={`지금: ${now(model)}`} onClick={() => onPick(connection.id, model.id)} />),
    ];
  });
  return (
    <>
      {search.field}
      {search.none ? <Empty variant="menu">{search.none}</Empty> : shown}
    </>
  );
}
