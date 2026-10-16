import { sameModelRef, type ModelRef, type Role } from '../../connectors/assignment';
import { imageOnly, setDefaultModel } from '../../runtime/assignment';
import { modelProfile, profileUsers } from '../../runtime/profiles';
import { TASK_NAMES } from '../common/prompt-words';
import { ROLES } from '../../connectors/assignment';
import { findStarred, RoleCard } from '../common/RolePicker';
import { useSearch } from '../common/useSearch';
import { AUX_HELP, DEFAULT_MODELS, defaultMark, follows, MODEL_ROLES, MODEL_SETTINGS, NOT_STARRED, noStarred, PAGES, ROLE_TAGS } from '../common/words';
import { useConnections, useProfiles, usePrompts, useSettings, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Beside, Callout, Columns, Empty, List, ListItem, NavBar, PickCard, Row, Screen, Section } from '../ui';
import { defaultFirst, valueWords } from './settingWords';

const STARRED = '즐겨찾기한 모델';

// The screens never say 묶음.
const NO_VALUES = '정한 값 없음';
// The bottom rung of every chat's settings: what a prompt, a character or a chat does not set reads from here.
const DEFAULTS = '기본값';
const SETTINGS_HELP = '온도나 추론, 캐시 같은 값이에요. 모델마다 따로 정해 둘 수도 있어요.';
export function ModelsScreen({ back }: { back: Back | null }) {
  const store = useStore();
  const toast = useToast();
  const profiles = useProfiles();
  const connections = useConnections();
  const settings = useSettings();
  const prompts = usePrompts();

  const main = settings.models.main;
  const pickModel = (role: Role, ref: ModelRef | null) =>
    void setDefaultModel(store, role, ref).then((result) => {
      if (!result.ok) toast.failed(result, `${DEFAULT_MODELS}을 바꾸지 못했어요.`);
    });
  const models = connections.flatMap((connection) => connection.value.starred.map((model) => ({ connection, model, choice: modelProfile(store, model) })));
  // The values a model's 모델 설정 sets, led by its name only when it is not the default one.
  const valuesOf = (choice: ReturnType<typeof modelProfile>) => {
    if (choice.kind !== 'profile') return `${MODEL_SETTINGS} 없음`;
    const words = valueWords(choice.profile.value.settings);
    const text = words.length ? words.join(' · ') : NO_VALUES;
    return choice.profile.id === settings.profile ? text : `${choice.profile.value.name} · ${text}`;
  };
  const rolesOf = (ref: ModelRef) => (Object.keys(ROLES) as Role[]).filter((role) => settings.models[role] && sameModelRef(settings.models[role]!, ref));
  const cardOf = (ref: ModelRef | undefined) => {
    const found = ref && models.find(({ connection, model }) => connection.id === ref.connection && model.id === ref.model);
    if (!found) return {};
    return { values: imageOnly(found.model) ? undefined : valuesOf(found.choice), open: () => navigate({ kind: 'model', connection: found.connection.id, model: found.model.id }) };
  };
  const search = useSearch(models, '즐겨찾기한 모델 검색', ({ connection, model }) => [model.name, model.id, connection.value.label]);
  const sorted = defaultFirst(profiles, settings.profile);
  const defaultProfile = profiles.find((profile) => profile.id === settings.profile);
  const defaultWords = defaultProfile ? valueWords(defaultProfile.value.settings) : [];
  const ownModels = prompts.flatMap((prompt) => (prompt.value.task && prompt.value.model ? [{ prompt, task: prompt.value.task, model: prompt.value.model }] : []));

  const side = (
    <>
      <Section title={MODEL_SETTINGS}>
        <List label={MODEL_SETTINGS} box>
          {sorted.map((profile) => {
            const words = valueWords(profile.value.settings);
            const used = profileUsers(connections, settings.profile, profile.id).length;
            return (
              <ListItem
                key={profile.id}
                title={profile.value.name}
                badge={defaultMark(profile.id === settings.profile, profile.value.name)}
                description={words.length ? words.join(' · ') : NO_VALUES}
                aside={used ? `모델 ${used}개` : undefined}
                onClick={() => navigate({ kind: 'profile', id: profile.id })}
              />
            );
          })}
        </List>
      </Section>
      {ownModels.length > 0 && (
        <Section title="프롬프트에서 정한 모델" help={`이 프롬프트로 작업할 때는 ${MODEL_ROLES.aux} 대신 이 모델을 써요.`}>
          <List label="프롬프트에서 정한 모델" box>
            {ownModels.map(({ prompt, task, model }) => (
              <ListItem
                key={prompt.id}
                title={prompt.value.name}
                tags={[TASK_NAMES[task]]}
                aside={findStarred(model, connections)?.name ?? NOT_STARRED}
                onClick={() => navigate({ kind: 'prompt', id: prompt.id, pane: null })}
              />
            ))}
          </List>
        </Section>
      )}
    </>
  );

  return (
    <Screen width="page" top={<NavBar title={PAGES.models} {...backBar(back)} />}>
      <Section title={DEFAULTS}>
        <Columns>
          <RoleCard role="main" help="프롬프트나 채팅에서 모델을 따로 정하지 않았을 때 쓰는 모델이에요." own={main} follow={null} connections={connections} onPick={(ref) => ref && pickModel('main', ref)} {...cardOf(main)} />
          <RoleCard role="aux" help={AUX_HELP} own={settings.models.aux} follow={follows(MODEL_ROLES.main)} connections={connections} onPick={(ref) => pickModel('aux', ref)} {...cardOf(settings.models.aux)} />
          <RoleCard role="embed" help="장기 기억이 지금 대화와 관련된 지난 기록을 찾을 때와, 도구가 비슷한 내용을 찾을 때 써요. 모델을 바꾸면 기록을 다시 준비해요." own={settings.models.embed} follow="정하지 않음" connections={connections} onPick={(ref) => pickModel('embed', ref)} />
          <PickCard
            label={MODEL_SETTINGS}
            value={defaultProfile ? defaultProfile.value.name : '없음'}
            note={defaultProfile ? (defaultWords.length ? defaultWords.join(' · ') : `${NO_VALUES} · 모델 기본값 사용`) : undefined}
            help={SETTINGS_HELP}
            tone={defaultProfile ? 'default' : 'warn'}
            onClick={() => navigate(defaultProfile ? { kind: 'profile', id: defaultProfile.id } : { kind: 'models' })}
          />
        </Columns>
        {main && !findStarred(main, connections) && <Callout tone="warn">{`${MODEL_ROLES.main}로 정한 모델이 즐겨찾기에 없어요.`}</Callout>}
      </Section>
      <Beside side={side}>
        <Section title={STARRED}>
          {search.field && <Row kind="toolbar">{search.field}</Row>}
          {search.none ? (
            <Empty variant="section">{search.none}</Empty>
          ) : models.length > 0 ? (
            <List label={STARRED} box>
              {search.found.map(({ connection, model, choice }) => {
                const ref = { connection: connection.id, model: model.id };
                // The row says only what sets a model apart: its roles, and a 모델 설정 other than the default one.
                // A model that only draws takes no 설정 (ModelScreen).
                const apart = imageOnly(model) ? '이미지 모델' : choice.kind !== 'profile' ? `${MODEL_SETTINGS} 없음` : choice.profile.id === settings.profile ? undefined : choice.profile.value.name;
                return (
                  <ListItem
                    key={`${connection.id}/${model.id}`}
                    title={model.name}
                    tags={rolesOf(ref).map((role) => ROLE_TAGS[role])}
                    description={connection.value.label}
                    aside={apart}
                    onClick={() => navigate({ kind: 'model', ...ref })}
                  />
                );
              })}
            </List>
          ) : (
            <Empty variant="section">{noStarred('설정할 수 있어요')}</Empty>
          )}
        </Section>
      </Beside>
    </Screen>
  );
}
