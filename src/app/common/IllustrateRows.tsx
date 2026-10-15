import { useState } from 'react';
import { sameModelRef } from '../../connectors/assignment';
import type { IllustrateSwitches, Rung } from '../../model/illustration';
import type { IllustrateSetup } from '../../runtime/characters';
import { drawingModels, type ImageRoute } from '../../runtime/illustrate';
import { useConnections } from '../session';
import { navigate } from '../shell/router';
import { Button, ChipButton, IconButton, Menu, MenuHeading, MenuItem, NumberInput, SettingRow, Switch } from '../ui';
import { ACTS, addOf, newOf } from './acts';
import { readTyped } from './typedNumber';
import { appliesTo, TaskPromptMenu } from './TaskPrompt';
import { follows, NOT_STARRED } from './words';

type Props = {
  illustrate: IllustrateSetup;
  card: { name: string } | null;
  opens: 'up' | 'down';
  onChange: (change: Partial<IllustrateSwitches>) => void;
  onEditPrompt: (id: string | null) => void;
};

// 삽화's shared values, the same rows in the chat's 삽화 dialog and on 채팅 기본값's 삽화 page.
export function IllustrateRows({ illustrate, card, opens, onChange, onEditPrompt }: Props) {
  const routes = drawingModels(useConnections());
  return (
    <>
      <SettingRow
        label="자동 삽화"
        help="응답을 받을 때마다 삽화를 만들어요. 만들 때마다 이미지 연결의 사용량이 들어요."
        control={<Switch label="자동 삽화" checked={illustrate.auto} onChange={(auto) => onChange({ auto })} />}
      />
      <PictureLadder ladder={illustrate.ladder} onChange={(ladder) => onChange({ ladder: ladder.length ? ladder : undefined })} />
      <SettingRow
        label="무료가 아니어도 만들기"
        help="무료 사용량을 다 썼거나 요금제에 무료 이미지가 없을 때도 묻지 않고 만들어요. 이때는 비용이 들어요."
        control={<Switch label="무료가 아니어도 만들기" checked={illustrate.spend} onChange={(spend) => onChange({ spend })} />}
      />
      <SettingRow
        label="이미지 모델"
        sub={routes.length ? undefined : '이미지를 만들 모델이 없어요'}
        control={
          routes.length ? (
            <ImageModelMenu routes={routes} illustrate={illustrate} card={card} opens={opens} onPick={onChange} />
          ) : (
            <Button variant="ghost" size="sm" onClick={() => navigate({ kind: 'add-connection' })}>
              {newOf('연결')}
            </Button>
          )
        }
      />
      <SettingRow
        label="삽화 프롬프트"
        control={<TaskPromptMenu task="illustrate" chosen={illustrate.prompt} heading={appliesTo(card, illustrate.own)} opens={opens} onPick={(prompt) => onChange({ prompt })} onEdit={onEditPrompt} />}
      />
    </>
  );
}

// A new rung's length past the last one's.
const RUNG = 3000;

type Draft = { from: string; count: string };
type Read = { ok: true; rung: Rung } | { ok: false; error: string };

// What a rung's fields hold, or why it cannot be saved: a longer length and more pictures than the rung before, or
// than the one picture every reply gets.
function readRung({ from, count }: Draft, before: Rung | null): Read {
  const least = { from: (before?.from ?? 0) + 1, count: (before?.count ?? 1) + 1 };
  const length = readTyped(from, true);
  if (!length.ok) return length;
  if (length.value < least.from) return { ok: false, error: `${least.from.toLocaleString('ko-KR')}자 이상을 입력해 주세요.` };
  const pictures = readTyped(count, true);
  if (!pictures.ok) return pictures;
  if (pictures.value < least.count) return { ok: false, error: `${least.count}장 이상을 입력해 주세요.` };
  return { ok: true, rung: { from: length.value, count: pictures.value } };
}

// Each read against the last rung that reads.
function readAll(drafts: Draft[]): Read[] {
  const read: Read[] = [];
  let before: Rung | null = null;
  for (const draft of drafts) {
    const rung = readRung(draft, before);
    if (rung.ok) before = rung.rung;
    read.push(rung);
  }
  return read;
}

const draftOf = ({ from, count }: Rung): Draft => ({ from: String(from), count: String(count) });

// 삽화 수 (model/illustration pictureCount): one picture, and each rung's count from its length on. The ladder is saved
// only while every rung reads.
function PictureLadder({ ladder, onChange }: { ladder: Rung[]; onChange: (ladder: Rung[]) => void }) {
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const shown = drafts ?? ladder.map(draftOf);
  const read = readAll(shown);
  const type = (at: number, change: Partial<Draft>) => {
    const next = shown.with(at, { ...shown[at]!, ...change });
    setDrafts(next);
    const rungs = readAll(next);
    if (rungs.every((rung) => rung.ok)) onChange(rungs.map((rung) => (rung as Extract<Read, { ok: true }>).rung));
  };
  const save = (next: Rung[]) => {
    setDrafts(null);
    onChange(next);
  };
  const last = ladder.at(-1);
  return (
    <>
      <SettingRow
        label="삽화 수"
        help="응답이 길면 삽화를 더 만들어요. 글자 수는 태그를 빼고 세어요."
        sub={ladder.length ? undefined : '응답마다 1장'}
        control={
          <Button variant="ghost" size="sm" icon={ACTS.create.icon} onClick={() => save([...ladder, { from: (last?.from ?? 0) + RUNG, count: (last?.count ?? 1) + 1 }])}>
            {addOf('단계')}
          </Button>
        }
      />
      {shown.map((draft, at) => {
        const rung = read[at]!;
        const name = `${at + 1}단계`;
        return (
          <SettingRow
            key={at}
            label={name}
            sentence={
              <>
                <NumberInput label={`${name} 글자 수`} value={draft.from} unit="자" invalid={!rung.ok} onChange={(from) => type(at, { from })} />
                {' 이상이면 '}
                <NumberInput label={`${name} 장 수`} value={draft.count} unit="장" invalid={!rung.ok} onChange={(count) => type(at, { count })} />
              </>
            }
            error={rung.ok ? undefined : rung.error}
            control={<IconButton icon={ACTS.remove.icon} size="xs" label={`${name} ${ACTS.remove.label}`} onClick={() => save(ladder.toSpliced(at, 1))} />}
          />
        );
      })}
    </>
  );
}

// The image model the switches draw with: their own choice, else the first starred model that draws.
export const imageModelOf = (routes: ImageRoute[], illustrate: IllustrateSetup) => {
  const own = illustrate.model;
  return own ? routes.find(({ connection, model }) => sameModelRef(own, { connection: connection.id, model: model.id })) : routes[0];
};

// One no longer starred shows as missing, never as another model.
function ImageModelMenu({ routes, illustrate, card, opens, onPick }: Pick<Props, 'illustrate' | 'card' | 'opens'> & { routes: ImageRoute[]; onPick: Props['onChange'] }) {
  const own = illustrate.model;
  const choice = imageModelOf(routes, illustrate);
  return (
    <Menu
      place={opens === 'up' ? 'above-end' : 'below-end'}
      label="이미지 모델"
      trigger={(opener) => <ChipButton variant="field" opens={opens} label={choice ? choice.model.name : NOT_STARRED} title="이미지 모델" tone={choice ? 'default' : 'warn'} {...opener} />}
    >
      <MenuHeading>{appliesTo(card, illustrate.own)}</MenuHeading>
      <MenuItem label={follows('첫 이미지 모델')} sub={routes[0]!.model.name} checked={!own} onClick={() => onPick({ model: undefined })} />
      {routes.map(({ connection, model }) => (
        <MenuItem
          key={`${connection.id}/${model.id}`}
          label={model.name}
          sub={connection.value.label}
          checked={!!own && sameModelRef(own, { connection: connection.id, model: model.id })}
          onClick={() => onPick({ model: { connection: connection.id, model: model.id } })}
        />
      ))}
    </Menu>
  );
}
