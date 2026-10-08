import { useEffect, useState } from 'react';
import { modelSettings } from '../../connectors/registry';
import { fit } from '../../connectors/settings';
import type { Modality, Starred } from '../../connectors/types';
import type { Stored } from '../../model/kinds';
import { modelUsage, type ModelUsage } from '../../model/chat';
import { addProfile, modelProfile, setModelProfile } from '../../runtime/profiles';
import { money } from '../common/money';
import { UNKNOWN } from '../common/receipt';
import { tally } from '../common/usage';
import { ago } from '../common/time';
import { useProfiles, useSettings, useSession } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, ChipButton, Divider, Empty, Facts, Menu, MenuItem, NavBar, Row, Screen, Section, SettingGroup, SettingRow, Text } from '../ui';
import { changeWords, defaultFirst, NOT_CALLABLE, valueWords } from './settingWords';
import { count } from '../common/typedNumber';

const MODALITY: Record<Modality, string> = { text: '텍스트', image: '이미지', audio: '오디오', video: '영상', file: '파일' };

// What the catalog said when the model was starred. null is unknown, never 안 됨.
const can = (value: boolean | null) => (value === null ? UNKNOWN : value ? '됨' : '안 됨');
const tokens = (value: number | null) => (value === null ? UNKNOWN : `${count(value)} 토큰`);

function spent({ costs, costUnknown }: ModelUsage): string {
  if (!costs.length) return UNKNOWN;
  const sums = costs.map(({ unit, amount, estimated }) => `${estimated ? '약 ' : ''}${money(unit, amount)}`).join(' + ');
  return costUnknown ? `${sums} · 알 수 없음 ${costUnknown}회` : sums;
}

export function ModelScreen({ connection, model, back }: { connection: Stored<'connection'>; model: Starred; back: Back }) {
  const { store, usage: usageIndex } = useSession();
  const toast = useToast();
  const profiles = useProfiles();
  const settings = useSettings();
  const [usageAttempt, retryUsage] = useState(0);
  const [usage, setUsage] = useState<ModelUsage | null>(null);
  const [usageFailed, setUsageFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    setUsage(null);
    setUsageFailed(false);
    void usageIndex.read((chats) => modelUsage(chats, { connection: connection.id, model: model.id }), abort.signal).then((result) => {
      if (abort.signal.aborted) return;
      if (result.ok) setUsage(result.data);
      else setUsageFailed(true);
    });
    return () => abort.abort();
  }, [usageIndex, connection.id, model.id, usageAttempt]);
  const choice = modelProfile(store, model);
  const current = choice.kind === 'profile' ? choice.profile : null;
  const schema = modelSettings(connection.value, model);
  const sorted = defaultFirst(profiles, settings.profile);


  // The default is what a model without its own uses, so picking it clears the model's own.
  async function choose(id: string) {
    const saved = await setModelProfile(store, connection.id, model.id, id === settings.profile ? null : id);
    if (!saved.ok) toast.failed(saved, '바꾸지 못했어요.');
  }

  function own() {
    const id = crypto.randomUUID();
    // The model takes the profile only once it exists: a create that fails must leave no model pointing at it.
    void addProfile(store, { name: `${model.name}용`, settings: current?.value.settings ?? {} }, id).then(async (made) => {
      if (!made.ok) return toast.failed(made, '설정을 만들지 못했어요.');
      const saved = await setModelProfile(store, connection.id, model.id, id);
      if (!saved.ok) toast.failed(saved, '바꾸지 못했어요.');
    });
    navigate({ kind: 'profile', id });
  }

  const words = current && valueWords(current.value.settings);
  const sent = current && (schema ? changeWords(fit(schema, current.value.settings).changes) : NOT_CALLABLE);

  return (
    <Screen width="form" top={<NavBar title={model.name} subtitle={connection.value.label} {...backBar(back)} />}>
      <SettingGroup label="쓰는 설정">
        <SettingRow
          label="쓰는 설정"
          help="같은 설정을 쓰는 모델은 함께 바뀌어요."
          sub={current ? (words?.length ? words.join(' · ') : '정한 값 없음') : undefined}
          error={current ? undefined : '쓰던 설정이 삭제돼서 이 모델을 사용할 수 없어요.'}
          note={sent || undefined}
          control={
            <>
              <Menu
                place="below-end"
                label="쓸 설정 선택"
                trigger={(opener) => <ChipButton variant="field" tone={current ? 'default' : 'warn'} label={current ? current.value.name : '없음'} title="쓸 설정" {...opener} />}
              >
                {sorted.map((profile) => (
                  <MenuItem key={profile.id} label={profile.value.name} tag={profile.id === settings.profile ? '기본' : undefined} checked={profile.id === current?.id} onClick={() => void choose(profile.id)} />
                ))}
                <Divider variant="menu" />
                <MenuItem label="이 모델 전용 설정 만들기" onClick={own} />
              </Menu>
              {current && (
                <Button variant="secondary" size="sm" onClick={() => navigate({ kind: 'profile', id: current.id })}>
                  열기
                </Button>
              )}
            </>
          }
        />
      </SettingGroup>

      <Section title="모델">
        <Facts
          items={[
            { label: '연결', value: connection.value.label },
            { label: '모델 ID', value: model.id },
            { label: '컨텍스트 길이', value: tokens(model.contextLength) },
            { label: '응답 최대 길이', value: tokens(model.maxOutput) },
            { label: '입력', value: model.input ? model.input.map((modality) => MODALITY[modality]).join(', ') : UNKNOWN },
            { label: '추론', value: can(model.reasoning) },
            { label: '도구', value: can(model.tools) },
          ]}
        />
        <Row kind="actions">
          <Button variant="secondary" size="sm" onClick={() => navigate({ kind: 'connection', id: connection.id })}>
            연결 열기
          </Button>
        </Row>
      </Section>

      <Section title="사용량" note="남아 있는 채팅 기준 · 마지막 집계" action={<Button variant="secondary" size="sm" onClick={() => retryUsage((attempt) => attempt + 1)}>다시 집계</Button>}>
        {usage === null ? <Text>{usageFailed ? '사용량을 불러오지 못했어요.' : '사용량을 확인하는 중'}</Text> : usage.last !== null ? (
          <Facts
            variant="tiles"
            items={[
              { label: '응답', value: `${count(usage.calls)}번` },
              { label: '마지막', value: ago(usage.last) },
              { label: '입력 토큰', value: tally(usage.input, usage.calls) },
              { label: '출력 토큰', value: tally(usage.output, usage.calls) },
              { label: '비용', value: spent(usage) },
            ]}
          />
        ) : (
          <Empty variant="section">이 모델로 받은 응답이 없어요.</Empty>
        )}
      </Section>
    </Screen>
  );
}
