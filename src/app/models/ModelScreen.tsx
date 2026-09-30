import { modelSettings } from '../../connectors/registry';
import { fit } from '../../connectors/settings';
import type { Modality, Starred } from '../../connectors/types';
import type { Stored } from '../../model/kinds';
import { modelUsage, type ModelUsage } from '../../model/chat';
import { addProfile, modelProfile, setModelProfile } from '../../runtime/profiles';
import { money } from '../common/money';
import { UNKNOWN } from '../common/receipt';
import { ago } from '../common/time';
import { useChatMessages, useProfiles, useSettings, useStore } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Callout, ChipButton, Divider, Empty, Facts, List, ListItem, Menu, MenuItem, NavBar, Row, Screen, Section, Text } from '../ui';
import { changeWords, defaultFirst, NOT_CALLABLE, valueWords } from './settingWords';
import { count } from './typedNumber';

const MODALITY: Record<Modality, string> = { text: '텍스트', image: '이미지', audio: '소리', video: '영상', file: '파일' };

// What the catalog said when the model was starred. null is unknown, never 안 됨.
const can = (value: boolean | null) => (value === null ? UNKNOWN : value ? '됨' : '안 됨');
const tokens = (value: number | null) => (value === null ? UNKNOWN : `${count(value)} 토큰`);

// A total leaves out the calls that did not report it, and says how many there were.
function tally({ total, unknown }: ModelUsage['input'], calls: number): string {
  if (unknown === calls) return UNKNOWN;
  return unknown ? `${count(total)} · ${unknown}번은 알 수 없음` : count(total);
}

function spent({ costs, costUnknown }: ModelUsage): string {
  if (!costs.length) return UNKNOWN;
  const sums = costs.map(({ unit, amount, estimated }) => `${estimated ? '약 ' : ''}${money(unit, amount)}`).join(' + ');
  return costUnknown ? `${sums} · ${costUnknown}번은 알 수 없음` : sums;
}

// One starred model: the settings it uses, which it picks here, what it is, and what it has cost.
export function ModelScreen({ connection, model, back }: { connection: Stored<'connection'>; model: Starred; back: Back }) {
  const store = useStore();
  const toast = useToast();
  const profiles = useProfiles();
  const settings = useSettings();
  const messages = useChatMessages();
  const choice = modelProfile(store, model);
  const current = choice.kind === 'profile' ? choice.profile : null;
  const schema = modelSettings(connection.value, model);
  const sorted = defaultFirst(profiles, settings.profile);
  const usage = modelUsage(
    messages,
    { connection: connection.id, model: model.id },
  );

  // The default is what a model without its own uses, so picking it clears the model's own.
  async function choose(id: string) {
    const saved = await setModelProfile(store, connection.id, model.id, id === settings.profile ? null : id);
    if (!saved.ok) toast.failed(saved, '바꾸지 못했어요.');
  }

  // A copy of what the model uses now, so only the values changed afterwards differ.
  async function own() {
    const made = await addProfile(store, { name: `${model.name}용`, settings: current?.value.settings ?? {} });
    if (!made.ok) return toast.failed(made, '설정을 만들지 못했어요.');
    const saved = await setModelProfile(store, connection.id, model.id, made.data.id);
    if (!saved.ok) return toast.failed(saved, '바꾸지 못했어요.');
    navigate({ kind: 'profile', id: made.data.id });
  }

  const words = current && valueWords(current.value.settings);
  const sent = current && (schema ? changeWords(fit(schema, current.value.settings).changes) : NOT_CALLABLE);

  return (
    <Screen width="form" top={<NavBar title={model.name} subtitle={connection.value.label} {...backBar(back)} />}>
      <Section
        title="쓰는 설정"
        hint="같은 설정을 쓰는 모델은 함께 바뀌어요."
        action={
          <Menu
            place="below-end"
            label="쓸 설정 고르기"
            trigger={(opener) => <ChipButton tone={current ? 'default' : 'warn'} label={current ? current.value.name : '없음'} title="쓸 설정" {...opener} />}
          >
            {sorted.map((profile) => (
              <MenuItem key={profile.id} label={profile.value.name} tag={profile.id === settings.profile ? '기본' : undefined} checked={profile.id === current?.id} onClick={() => void choose(profile.id)} />
            ))}
            <Divider variant="menu" />
            <MenuItem label="이 모델만 따로 설정하기" onClick={() => void own()} />
          </Menu>
        }
      >
        {current ? (
          <List label="쓰는 설정">
            <ListItem
              title={current.value.name}
              badge={current.id === settings.profile ? '기본' : undefined}
              description={words?.length ? words.join(' · ') : '정한 값이 없어요. 모두 모델 원래 값으로 보내요.'}
              aside="열기"
              onClick={() => navigate({ kind: 'profile', id: current.id })}
            />
          </List>
        ) : (
          <Callout tone="warn">쓰던 설정이 지워졌어요. 다른 설정을 골라야 이 모델로 보낼 수 있어요.</Callout>
        )}
        {sent && (
          <Text variant="note">
            {sent}
          </Text>
        )}
      </Section>

      <Section title="모델">
        <Facts
          items={[
            { label: '연결', value: connection.value.label },
            { label: '모델 ID', value: model.id },
            { label: '컨텍스트 길이', value: tokens(model.contextLength) },
            { label: '답장 최대 길이', value: tokens(model.maxOutput) },
            { label: '입력', value: model.input ? model.input.map((modality) => MODALITY[modality]).join(', ') : UNKNOWN },
            { label: '생각', value: can(model.reasoning) },
            { label: '도구', value: can(model.tools) },
          ]}
        />
        <Row kind="actions">
          <Button variant="secondary" size="sm" onClick={() => navigate({ kind: 'connection', id: connection.id })}>
            연결 열기
          </Button>
        </Row>
      </Section>

      <Section title="사용량" note="남아 있는 채팅 기준">
        {usage.last !== null ? (
          <Facts
            variant="tiles"
            items={[
              { label: '답장', value: `${count(usage.calls)}번` },
              { label: '마지막', value: ago(usage.last) },
              { label: '입력 토큰', value: tally(usage.input, usage.calls) },
              { label: '출력 토큰', value: tally(usage.output, usage.calls) },
              { label: '비용', value: spent(usage) },
            ]}
          />
        ) : (
          <Empty variant="section">아직 이 모델로 받은 답장이 없어요.</Empty>
        )}
      </Section>
    </Screen>
  );
}
