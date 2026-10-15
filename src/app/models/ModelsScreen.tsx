import { sameModelRef, type ModelRef, type Role } from '../../connectors/assignment';
import { imageOnly, setDefaultModel } from '../../runtime/assignment';
import { modelProfile, profileUsers } from '../../runtime/profiles';
import { TASK_NAMES } from '../common/prompt-words';
import { ROLES } from '../../connectors/assignment';
import { findStarred, RoleCard } from '../common/RolePicker';
import { useSearch } from '../common/useSearch';
import { AUX_HELP, DEFAULT_MODELS, defaultMark, follows, MODEL_ROLES, MODEL_SETTINGS, NOT_STARRED, noStarred, PAGES, ROLE_TAGS } from '../common/words';
import { useConnections, useProfiles, usePrompts, useSettings, useStore } from '../session';
import { backBar, navigate, useRoute } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Beside, Callout, Columns, Empty, List, ListItem, NavBar, Row, Screen, Section, Table, Tag, type TableColumn } from '../ui';
import { defaultFirst, inputs, tokens, valueWords } from './settingWords';

const STARRED = '즐겨찾기한 모델';
const COLUMNS: TableColumn[] = [
  { label: '모델', size: 'name' },
  { label: '연결', size: 'fill' },
  { label: MODEL_SETTINGS, size: 'fill' },
  { label: '컨텍스트', size: 'fill' },
  { label: '입력', size: 'fill' },
];

// The screens never say 묶음.
const NO_VALUES = '정한 값 없음';
export function ModelsScreen({ back }: { back: Back | null }) {
  const store = useStore();
  const toast = useToast();
  const route = useRoute();
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
                current={route.kind === 'profile' && route.id === profile.id}
                onClick={() => navigate({ kind: 'profile', id: profile.id })}
              />
            );
          })}
        </List>
      </Section>
      {ownModels.length > 0 && (
        <Section title="프롬프트에서 정한 모델" help={`이 프롬프트의 작업에는 ${MODEL_ROLES.aux} 대신 이 모델을 사용해요.`}>
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
      <Section title={DEFAULT_MODELS}>
        <Columns>
          <RoleCard role="main" help="프롬프트나 채팅에서 정하지 않았을 때 쓰는 모델이에요." own={main} follow={null} connections={connections} onPick={(ref) => ref && pickModel('main', ref)} {...cardOf(main)} />
          <RoleCard role="aux" help={AUX_HELP} own={settings.models.aux} follow={follows(MODEL_ROLES.main)} connections={connections} onPick={(ref) => pickModel('aux', ref)} {...cardOf(settings.models.aux)} />
          <RoleCard role="embed" help="장기 기억이 지금 대화와 관련된 지난 기록을 찾을 때, 도구가 비슷한 내용을 찾을 때 써요. 바꾸면 기록을 다시 준비해요." own={settings.models.embed} follow="정하지 않음" connections={connections} onPick={(ref) => pickModel('embed', ref)} />
        </Columns>
        {main && !findStarred(main, connections) && <Callout tone="warn">{`${MODEL_ROLES.main}로 정한 모델이 즐겨찾기에 없어요.`}</Callout>}
      </Section>
      <Beside side={side}>
        <Section title={STARRED} help={`새로 즐겨찾기한 모델은 기본으로 지정한 ${MODEL_SETTINGS}을 사용해요.`}>
          {search.field && <Row kind="toolbar">{search.field}</Row>}
          {search.none ? (
            <Empty variant="section">{search.none}</Empty>
          ) : models.length > 0 ? (
            <Table
              label={STARRED}
              columns={COLUMNS}
              rows={search.found.map(({ connection, model, choice }) => {
                // A model that only draws takes no 설정 and holds no conversation, so it has neither (ModelScreen).
                const draws = imageOnly(model);
                const ref = { connection: connection.id, model: model.id };
                const roles = rolesOf(ref);
                return {
                  key: `${connection.id}/${model.id}`,
                  cells: [
                    roles.length ? (
                      <>
                        {model.name}{' '}
                        {roles.map((role) => (
                          <Tag key={role} tone="accent">
                            {ROLE_TAGS[role]}
                          </Tag>
                        ))}
                      </>
                    ) : (
                      model.name
                    ),
                    connection.value.label,
                    draws ? '이미지 모델' : valuesOf(choice),
                    draws ? null : tokens(model.contextLength),
                    inputs(model),
                  ],
                  summary: connection.value.label,
                  current: route.kind === 'model' && route.connection === connection.id && route.model === model.id,
                  onClick: () => navigate({ kind: 'model', ...ref }),
                };
              })}
            />
          ) : (
            <Empty variant="section">{noStarred('설정할 수 있어요')}</Empty>
          )}
        </Section>
      </Beside>
    </Screen>
  );
}
