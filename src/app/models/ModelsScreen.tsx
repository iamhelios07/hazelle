import type { ModelRef, Role } from '../../connectors/assignment';
import { imageOnly, setDefaultModel } from '../../runtime/assignment';
import { modelProfile, profileUsers } from '../../runtime/profiles';
import { TASK_NAMES } from '../common/prompt-words';
import { findStarred, RolePicker } from '../common/RolePicker';
import { AUX_HELP, DEFAULT_MODELS, follows, MODEL_ROLES, NOT_STARRED, noStarred, PAGES } from '../common/words';
import { useConnections, useProfiles, usePrompts, useSettings, useStore } from '../session';
import { backBar, navigate, useRoute } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Callout, Empty, List, ListItem, NavBar, Screen, Section, SettingGroup } from '../ui';
import { defaultFirst, valueWords } from './settingWords';

// The screens never say 묶음.
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
  const sorted = defaultFirst(profiles, settings.profile);
  const ownModels = prompts.flatMap((prompt) => (prompt.value.task && prompt.value.model ? [{ prompt, task: prompt.value.task, model: prompt.value.model }] : []));

  return (
    <Screen top={<NavBar title={PAGES.models} {...backBar(back)} />}>
      <Section title={DEFAULT_MODELS}>
        <SettingGroup label={DEFAULT_MODELS}>
          <RolePicker
            role="main"
            help="프롬프트나 채팅에서 정하지 않았을 때 쓰는 모델이에요."
            own={main}
            follow={null}
            connections={connections}
            onPick={(ref) => ref && pickModel('main', ref)}
          />
          <RolePicker
            role="aux"
            help={AUX_HELP}
            own={settings.models.aux}
            follow={follows(MODEL_ROLES.main)}
            connections={connections}
            onPick={(ref) => pickModel('aux', ref)}
          />
          <RolePicker
            role="embed"
            help="장기 기억이 지금 대화와 관련된 지난 기록을 찾을 때, 도구가 비슷한 내용을 찾을 때 써요. 바꾸면 기록을 다시 준비해요."
            own={settings.models.embed}
            follow="정하지 않음"
            connections={connections}
            onPick={(ref) => pickModel('embed', ref)}
          />
        </SettingGroup>
        {main && !findStarred(main, connections) && <Callout tone="warn">{`${MODEL_ROLES.main}로 정한 모델이 즐겨찾기에 없어요.`}</Callout>}
      </Section>
      {ownModels.length > 0 && (
        <Section title="프롬프트에서 정한 모델" hint="이 프롬프트의 작업에는 보조 모델 대신 이 모델을 사용해요.">
          <List label="프롬프트에서 정한 모델">
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
      <Section title="즐겨찾기한 모델" hint="새로 즐겨찾기한 모델은 기본 설정을 사용해요.">
        {models.length > 0 ? (
          <List label="즐겨찾기한 모델">
            {models.map(({ connection, model, choice }) => (
              <ListItem
                key={`${connection.id}/${model.id}`}
                title={model.name}
                tags={[connection.value.label]}
                aside={imageOnly(model) ? '이미지 모델' : choice.kind === 'profile' ? choice.profile.value.name : '설정 없음'}
                current={route.kind === 'model' && route.connection === connection.id && route.model === model.id}
                onClick={() => navigate({ kind: 'model', connection: connection.id, model: model.id })}
              />
            ))}
          </List>
        ) : (
          <Empty variant="section">{noStarred('설정할 수 있어요')}</Empty>
        )}
      </Section>
      <Section title="만들어 둔 설정">
        <List label="만들어 둔 설정">
          {sorted.map((profile) => {
            const words = valueWords(profile.value.settings);
            return (
              <ListItem
                key={profile.id}
                title={profile.value.name}
                badge={profile.id === settings.profile ? '기본' : undefined}
                description={words.length ? words.join(' · ') : '정한 값 없음'}
                aside={`모델 ${profileUsers(connections, settings.profile, profile.id).length}개`}
                current={route.kind === 'profile' && route.id === profile.id}
                onClick={() => navigate({ kind: 'profile', id: profile.id })}
              />
            );
          })}
        </List>
      </Section>
    </Screen>
  );
}
