import { useState, type ReactNode } from 'react';
import { modelSettings } from '../../connectors/registry';
import { fit, WHOLE, type Cache, type Change, type ModelSettings, type Reasoning, type SettingsSchema } from '../../connectors/settings';
import type { Stored } from '../../model/kinds';
import {
  addProfile,
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
import { SAVE_STATUS, useAutosave } from '../common/useAutosave';
import { useConnections, useProfiles, useSettings, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, ChoiceGroup, Disclosure, List, ListItem, Menu, MenuHeading, MenuItem, NavBar, NumberInput, PhraseField, Row, Screen, Section, SettingGroup, SettingRow, Stack, Text } from '../ui';
import { CACHE, changeWords, DETAIL, LEVELS, levelName, MAIN, NOT_CALLABLE, NUMBER, UNSET, type Field } from './settingWords';
import { count, readTyped } from './typedNumber';

const whole = (field: Field | 'budget') => field === 'budget' || field === 'context' || WHOLE.has(field);
const BUDGET_START = 8000;

type Choice = 'unset' | 'off' | 'adaptive' | 'budget' | `level:${string}`;
const choiceOf = (reasoning: Reasoning | undefined): Choice => (!reasoning ? 'unset' : reasoning.kind === 'level' ? `level:${reasoning.level}` : reasoning.kind);

// A model that uses the 묶음, with what it is sent of it. schema null: this version cannot call it.
type User = ProfileUser & { schema: SettingsSchema | null; changes: Change[] };

// The name rides in the settings' patch, so one queue orders both writes.
type Saved = ModelSettings & { name: string };
const split = ({ name, ...settings }: Partial<Saved>): { name?: string; settings: ModelSettings } => ({ name, settings });

export function ProfileScreen({ stored, back }: { stored: Stored<'profile'>; back: Back }) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const connections = useConnections();
  const profiles = useProfiles();
  const { id } = stored;
  const isDefault = settings.profile === id;

  const [drafts, setDrafts] = useState<Partial<Record<Field | 'budget', string>>>({});
  const [name, setName] = useState(stored.value.name);
  const { status, unsaved, change, save, flush } = useAutosave<Saved>(async (patch) => {
    const { name: renamed, settings: values } = split(patch);
    if (renamed !== undefined) {
      const done = await renameProfile(store, id, renamed);
      if (!done.ok) return done;
    }
    return Object.keys(values).length ? setProfileSettings(store, id, values) : { ok: true };
  });
  // What waits to be saved shows at once, over the stored copy.
  const shown = withSettings(stored.value.settings, split(unsaved).settings);
  const set = (values: ModelSettings) => void save(values);

  // An invalid draft shows its error and is never saved, and takes back a valid one still waiting; an empty one unsets.
  function type(field: Field | 'budget', draft: string, value: (number: number) => ModelSettings) {
    setDrafts((current) => ({ ...current, [field]: draft }));
    const key = field === 'budget' ? 'reasoning' : field;
    const typed = readTyped(draft, whole(field));
    if (draft.trim() === '' && field !== 'budget') change({ [key]: undefined });
    else change(typed.ok ? value(typed.value) : { [key]: undefined }, typed.ok);
  }

  function rename(next: string) {
    setName(next);
    // A blank name is never saved; the field shows its placeholder until one is typed.
    change({ name: next.trim() }, !!next.trim());
  }

  const users: User[] = profileUsers(connections, settings.profile, id).map((user) => {
    const schema = modelSettings(user.connection.value, user.model);
    return { ...user, schema, changes: schema ? fit(schema, shown).changes : [] };
  });
  const callable = users.filter((user): user is User & { schema: SettingsSchema } => user.schema !== null);

  // What some models are sent of a setting instead of the value, or nothing when all take it as it is.
  function noteFor(setting: Change['setting']): string | undefined {
    const left = users.filter((user) => user.changes.some((change) => change.setting === setting && change.change === 'left-out')).map((user) => user.model.name);
    const capped = users.flatMap((user) => user.changes.flatMap((change) => (change.setting === setting && change.change === 'capped' ? [`${user.model.name}에는 ${count(change.to)}`] : [])));
    const parts = [...(left.length ? [`${left.join(', ')}에는 빼고 보내요`] : []), ...(capped.length ? [`${capped.join(', ')}(으)로 맞춰 보내요`] : [])];
    return parts.length ? parts.join(' · ') : undefined;
  }

  function numberRow(field: Field): ReactNode {
    const { label, help, unit, unset } = NUMBER[field];
    const value = shown[field];
    const draft = drafts[field] ?? (value === undefined ? '' : String(value));
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
    // With no model to ask, every choice is offered; otherwise those some model here takes, and the one set.
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
    const draft = drafts.budget ?? (reasoning?.kind === 'budget' ? String(reasoning.tokens) : '');
    const typed = reasoning?.kind === 'budget' ? readTyped(draft, true) : null;
    return (
      <SettingRow
        key="reasoning"
        label="생각"
        changed={reasoning !== undefined}
        error={typed && !typed.ok ? typed.error : undefined}
        note={noteFor('reasoning')}
        wide
        control={
          <Stack gap="related">
            <ChoiceGroup layout="chips" label="생각" options={options} value={current} onChange={pick} />
            {reasoning?.kind === 'budget' && (
              <NumberInput label="생각 예산" unit="토큰" value={draft} invalid={!typed?.ok} onChange={(next) => type('budget', next, (tokens) => ({ reasoning: { kind: 'budget', tokens } }))} />
            )}
          </Stack>
        }
      />
    );
  }

  const cacheRow = (
    <SettingRow
      key="cache"
      label="캐시"
      help="보낸 앞부분을 저장해 두었다 다음 요청에서 싸게 다시 읽어요. Claude는 저장할 때 입력값의 1.25배(1시간은 2배), 다시 읽을 때 0.1배예요"
      changed={shown.cache !== undefined}
      note={noteFor('cache')}
      control={
        <ChoiceGroup
          layout="segmented"
          label="캐시"
          options={[{ value: 'off' as const, label: '끔' }, ...(Object.keys(CACHE) as Cache[]).map((value) => ({ value, label: CACHE[value] }))]}
          value={shown.cache ?? 'off'}
          onChange={(value) => set({ cache: value === 'off' ? undefined : value })}
        />
      }
    />
  );

  const stopRow = (
    <SettingRow
      key="stop"
      label="멈춤 문구"
      help="이 글이 나오면 답장을 거기서 끝내요"
      changed={shown.stop !== undefined}
      note={noteFor('stop')}
      control={<PhraseField label="멈춤 문구" phrases={shown.stop ?? []} onChange={(next) => set({ stop: next.length ? next : undefined })} />}
    />
  );

  const systemRow = (
    <SettingRow
      key="system"
      label="시스템 메시지 보내는 방식"
      help="시스템 메시지를 따로 받지 않는 모델이면 사용자 메시지로 바꿔 보내요"
      changed={shown.systemAsUser !== undefined}
      control={
        <ChoiceGroup
          layout="segmented"
          label="시스템 메시지 보내는 방식"
          options={[
            { value: 'as-is', label: '그대로' },
            { value: 'user', label: '사용자 메시지로' },
          ]}
          value={shown.systemAsUser ? 'user' : 'as-is'}
          onChange={(value) => set({ systemAsUser: value === 'user' ? true : undefined })}
        />
      }
    />
  );

  const summary = (user: User) => (user.schema ? changeWords(user.changes) : NOT_CALLABLE);

  const using = new Set(users.map((user) => `${user.connection.id}/${user.model.id}`));
  const profileName = (model: ProfileUser['model']) => {
    const named = model.profile ?? settings.profile;
    return profiles.find((profile) => profile.id === named)?.value.name ?? '없음';
  };
  const others = connections.map((connection) => ({ connection, models: connection.value.starred.filter((model) => !using.has(`${connection.id}/${model.id}`)) })).filter((group) => group.models.length > 0);
  // The default 묶음 is what a model without its own uses, so taking a model onto it clears the model's own.
  const attach = (connection: string, model: string) => void setModelProfile(store, connection, model, isDefault ? null : id).then((done) => done.ok || toast.failed(done, '저장하지 못했어요.'));

  async function copy() {
    await flush();
    const made = await addProfile(store, { name: `${name.trim() || stored.value.name} (사본)`, settings: shown });
    if (!made.ok) return toast.failed(made, '사본을 만들지 못했어요.');
    navigate({ kind: 'profile', id: made.data.id });
  }

  async function clearAll() {
    const previous = shown;
    const cleared: ModelSettings = {};
    for (const key of Object.keys(shown) as (keyof ModelSettings)[]) cleared[key] = undefined;
    setDrafts({});
    if (await save(cleared)) toast.undoable(`${stored.value.name}의 값을 모두 비웠어요.`, () => void setProfileSettings(store, id, previous));
  }

  async function remove() {
    await flush();
    const removed = await removeProfile(store, id);
    if (!removed.ok) {
      if (removed.error === 'default') return toast.error('기본 설정은 지울 수 없어요.', { detail: '다른 설정을 기본으로 정한 뒤 지워 주세요.' });
      return toast.failed(removed, '지우지 못했어요.');
    }
    navigate({ kind: 'models' });
    const note = users.length ? `이 설정을 쓰던 모델 ${users.length}개는 다른 설정을 골라야 보낼 수 있어요.` : undefined;
    toast.undoable(`${removed.data.value.name} 설정을 지웠어요.`, () => void restoreProfile(store, removed.data), note);
  }

  const detailSet = DETAIL.filter((field) => shown[field] !== undefined).length + (shown.stop ? 1 : 0) + (shown.systemAsUser ? 1 : 0);

  return (
    <Screen
      width="form"
      top={
        <NavBar
          title={name}
          rename={{ label: '설정 이름', placeholder: stored.value.name, onChange: rename }}
          {...backBar(back)}
          status={status ? SAVE_STATUS[status] : undefined}
        />
      }
    >
      <Stack gap="related">
        {isDefault ? (
          <Text variant="highlight">
            기본 설정이에요. 새로 별표한 모델과 설정을 따로 고르지 않은 모델이 이 설정을 써요.
          </Text>
        ) : (
          <Row kind="actions">
            <Button variant="link" size="xs" onClick={() => void setDefaultProfile(store, id).then((done) => done.ok || toast.failed(done, '저장하지 못했어요.'))}>
              기본 설정으로 정하기
            </Button>
          </Row>
        )}
      </Stack>

      <Section
        title="이 설정을 쓰는 모델"
        note={users.length ? `${users.length}개` : undefined}
        action={
          others.length > 0 && (
            <Menu
              place="below-end"
              size="lg"
              label="모델 추가"
              trigger={(opener) => (
                <Button variant="secondary" size="sm" {...opener}>
                  모델 추가
                </Button>
              )}
            >
              {others.map(({ connection, models }) => [
                <MenuHeading key={connection.id}>{connection.value.label}</MenuHeading>,
                ...models.map((model) => <MenuItem key={`${connection.id}/${model.id}`} label={model.name} sub={`지금: ${profileName(model)}`} onClick={() => attach(connection.id, model.id)} />),
              ])}
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
          <Text variant="note">
            아직 이 설정을 쓰는 모델이 없어요. 모델 추가로 골라 주세요.
          </Text>
        )}
      </Section>

      <Section title="자주 쓰는 설정" hint="비워 둔 값은 보내지 않아요. 모델이 받지 않는 값은 그 모델에만 빼거나 맞춰서 보내요.">
        <SettingGroup label="자주 쓰는 설정">
          {MAIN.map(numberRow)}
          {reasoningRow()}
          {cacheRow}
        </SettingGroup>
      </Section>

      <Disclosure label={detailSet ? `세부 설정 · ${detailSet}개 정함` : '세부 설정'}>
        <SettingGroup label="세부 설정">
          {DETAIL.map(numberRow)}
          {stopRow}
          {systemRow}
        </SettingGroup>
      </Disclosure>

      <Row kind="actions">
        <Button variant="secondary" size="sm" onClick={() => void copy()}>
          사본 만들기
        </Button>
        <Button variant="secondary" size="sm" disabled={Object.keys(shown).length === 0} onClick={() => void clearAll()}>
          모두 비우기
        </Button>
        {!isDefault && (
          <Button variant="danger" size="sm" onClick={() => void remove()}>
            이 설정 지우기
          </Button>
        )}
      </Row>
    </Screen>
  );
}
