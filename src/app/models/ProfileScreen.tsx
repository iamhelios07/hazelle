import type { Stored } from '../../model/kinds';
import { addProfile, modelProfile, removeProfile, restoreProfile, setDefaultProfile, setModelProfile, setProfileSettings, type ProfileUser } from '../../runtime/profiles';
import { ACTS, addOf } from '../common/acts';
import { useSearch } from '../common/useSearch';
import { SAVE_STATUS } from '../common/useAutosave';
import { BIN_KEEPS, defaultMark, MODEL_SETTINGS, RESET } from '../common/words';
import { useConnections, useProfiles, useSettings, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Empty, List, ListItem, Menu, MenuHeading, MenuItem, NavBar, Screen, Section, Tag } from '../ui';
import { changeWords, NOT_CALLABLE } from './settingWords';
import { useProfileEditor, type User } from './useProfileEditor';

export function ProfileScreen({ stored, back }: { stored: Stored<'profile'>; back: Back }) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const connections = useConnections();
  // modelProfile reads the store directly; profile edits must still refresh the attach-menu labels.
  useProfiles();
  const { id } = stored;
  const isDefault = settings.profile === id;
  const { status, name, rename, flush, clear, removing, shown, users, rows } = useProfileEditor(stored);
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
    const previous = await clear();
    if (previous) toast.undoable(`'${stored.value.name}' 설정을 기본값으로 되돌렸어요.`, () => setProfileSettings(store, id, previous));
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

      {rows}
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
