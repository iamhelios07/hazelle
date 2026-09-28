import { fitsRole } from '../../connectors/assignment';
import type { ApiFailure } from '../../runtime/api';
import { defaultModel, setDefaultModel } from '../../runtime/assignment';
import { setDefaultPersona } from '../../runtime/personas';
import { setDefaultPrompt } from '../../runtime/prompts';
import { useSettings, useStore, useViews } from '../session';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Callout, ChipButton, Empty, Menu, MenuItem, NavBar, Screen, Section, SettingGroup, SettingRow } from '../ui';

type Choice = { key: string; label: string; sub?: string; checked: boolean; pick: () => Promise<{ ok: true } | ApiFailure> };

// A chosen id that is no longer there reads as missing, never as another choice.
const MISSING = '없어졌어요';
const UNSET = '정하지 않음';

// The 전체 기본값 layer (design §4.1) and the defaults a new chat starts from (§4.2, §4.3). This is the only
// place they are chosen.
export function DefaultsScreen({ back }: { back: Back | null }) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const { prompts, personas, connections } = useViews();

  const prompt = settings.prompt === undefined ? null : prompts.find(({ id }) => id === settings.prompt);
  const persona = settings.persona === undefined ? null : personas.find(({ id }) => id === settings.persona);
  const main = defaultModel(settings);
  const models = connections.flatMap((connection) =>
    connection.value.starred.filter((model) => fitsRole(model, 'main')).map((model) => ({ connection, model, ref: { connection: connection.id, model: model.id } })),
  );
  const mainChoice = main && models.find(({ ref }) => ref.connection === main.connection && ref.model === main.model);
  const nameOf = (choice: (typeof models)[number]) => `${choice.model.name} · ${choice.connection.value.label}`;

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
            onClick={() =>
              void choice.pick().then((result) => {
                if (!result.ok) toast.failed(result, '기본값을 바꾸지 못했어요.');
              })
            }
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
              persona === null ? UNSET : (persona?.value.name ?? MISSING),
              personas.map(({ id, value }) => ({ key: id, label: value.name, checked: id === settings.persona, pick: () => setDefaultPersona(store, id) })),
              '페르소나가 없어요.',
            )}
          />
          <SettingRow
            label="본 대화 모델"
            help="프롬프트나 채팅에서 따로 정하지 않았을 때 쓰는 모델이에요."
            control={choose(
              '본 대화 모델',
              main === null ? UNSET : mainChoice ? nameOf(mainChoice) : MISSING,
              models.map((choice) => ({
                key: `${choice.ref.connection}/${choice.ref.model}`,
                label: choice.model.name,
                sub: choice.connection.value.label,
                checked: choice === mainChoice,
                pick: () => setDefaultModel(store, choice.ref),
              })),
              '별표 찍은 모델이 없어요. 연결에서 모델에 별표를 찍으면 여기서 고를 수 있어요.',
            )}
          />
        </SettingGroup>
        {main && !mainChoice && <Callout tone="warn">본 대화로 정했던 모델이 별표 목록에 없어요. 다시 골라 주세요.</Callout>}
      </Section>
    </Screen>
  );
}
