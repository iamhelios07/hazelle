import { sameModelRef } from '../../connectors/assignment';
import type { IllustrateSwitches } from '../../model/illustration';
import type { IllustrateSetup } from '../../runtime/characters';
import { drawingModels, type ImageRoute } from '../../runtime/illustrate';
import { useConnections } from '../session';
import { navigate } from '../shell/router';
import { Button, ChipButton, Menu, MenuHeading, MenuItem, SettingRow, Switch } from '../ui';
import { newOf } from './acts';
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
