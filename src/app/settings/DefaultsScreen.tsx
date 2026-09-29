import { ROLES, type ModelRef, type Role } from '../../connectors/assignment';
import type { ApiFailure } from '../../runtime/api';
import { setDefaultModel } from '../../runtime/assignment';
import { setDefaultPersona } from '../../runtime/personas';
import { setDefaultPrompt } from '../../runtime/prompts';
import { personaTitle } from '../common/persona-words';
import { findStarred, HelperPickers, ROLE_WORDS, RolePicker } from '../common/RolePicker';
import { useSettings, useStore, useViews } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Callout, ChipButton, Empty, Menu, MenuItem, NavBar, Screen, Section, SettingGroup, SettingRow, Text } from '../ui';

type Choice = { key: string; label: string; sub?: string; checked: boolean; pick: () => Promise<{ ok: true } | ApiFailure> };

// A chosen id that is no longer there reads as missing, never as another choice.
const MISSING = '없어졌어요';
const UNSET = '정하지 않음';

// The 전체 기본값 layer and the defaults a new chat starts from. This is the only place they are chosen.
export function DefaultsScreen({ back }: { back: Back | null }) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const { prompts, personas, connections } = useViews();

  const prompt = settings.prompt === undefined ? null : prompts.find(({ id }) => id === settings.prompt);
  const persona = settings.persona === undefined ? null : personas.find(({ id }) => id === settings.persona);
  const main = settings.models.main;
  const report = (result: { ok: true } | ApiFailure) => {
    if (!result.ok) toast.failed(result, '기본값을 바꾸지 못했어요.');
  };
  const pickModel = (role: Role, ref: ModelRef | null) => void setDefaultModel(store, role, ref).then(report);
  // An unset helper role is the same as the role it falls back to.
  const follow = (role: Role) => `${ROLE_WORDS[ROLES[role].fallsBackTo!]}와 같게`;

  const choose = (label: string, current: string, choices: Choice[], empty: string) => (
    <Menu place="below-end" label={label} trigger={(opener) => <ChipButton variant="field" label={current} title={label} {...opener} />}>
      {choices.length === 0 ? (
        <Empty variant="menu">{empty}</Empty>
      ) : (
        choices.map((choice) => (
          <MenuItem
            key={choice.key}
            label={choice.label}
            sub={choice.sub}
            checked={choice.checked}
            onClick={() => void choice.pick().then(report)}
          />
        ))
      )}
    </Menu>
  );

  return (
    <Screen width="form" top={<NavBar title="기본값" {...backBar(back)} />}>
      <Section title="새 채팅의 기본값">
        <SettingGroup label="새 채팅의 기본값">
          <SettingRow
            label="기본 프롬프트"
            help="새 채팅이 이 프롬프트로 시작해요. 채팅 안에서 바꾸면 그 채팅만 바뀌어요."
            control={choose(
              '기본 프롬프트',
              prompt === null ? UNSET : (prompt?.value.name ?? MISSING),
              prompts.map(({ id, value }) => ({ key: id, label: value.name, checked: id === settings.prompt, pick: () => setDefaultPrompt(store, id) })),
              '프롬프트가 없어요.',
            )}
          />
          <SettingRow
            label="기본 페르소나"
            help="새 채팅에서 내가 맡는 사람이에요. 채팅마다 입력창 옆에서 바꿀 수 있어요."
            control={choose(
              '기본 페르소나',
              persona === null ? UNSET : (persona ? personaTitle(persona.value) : MISSING),
              personas.map(({ id, value }) => ({ key: id, label: personaTitle(value), checked: id === settings.persona, pick: () => setDefaultPersona(store, id) })),
              '페르소나가 없어요.',
            )}
          />
          <RolePicker
            role="main"
            help="프롬프트나 채팅에서 따로 정하지 않았을 때 쓰는 모델이에요."
            own={main}
            follow={null}
            connections={connections}
            onPick={(ref) => ref && pickModel('main', ref)}
          />
        </SettingGroup>
        {main && !findStarred(main, connections) && <Callout tone="warn">본 대화로 정했던 모델이 별표 목록에 없어요. 다시 골라 주세요.</Callout>}
      </Section>
      <Section title="보조 모델" hint="프롬프트마다 따로 정할 수도 있어요.">
        <Text tone="muted">장기 기억·감정 에셋 기능은 아직 없어요. 기능이 들어오면 여기서 고른 모델을 써요.</Text>
        <HelperPickers
          models={settings.models}
          picker={(role, help) => (
            <RolePicker key={role} role={role} help={help} own={settings.models[role]} follow={follow(role)} connections={connections} onPick={(ref) => pickModel(role, ref)} />
          )}
        />
      </Section>
    </Screen>
  );
}
