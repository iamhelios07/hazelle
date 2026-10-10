import { ImageIcon } from 'lucide-react';
import { sameModelRef } from '../../connectors/assignment';
import { drawingModels, type ImageRoute } from '../../runtime/illustrate';
import { newOf } from '../common/acts';
import { follows, NOT_STARRED } from '../common/words';
import { useConnections } from '../session';
import { navigate } from '../shell/router';
import { Button, ChipButton, Menu, MenuHeading, MenuItem, SettingRow, Stack, Switch, Text, ToolButton } from '../ui';
import { appliesTo, TaskPromptMenu } from './ChatTaskPrompt';
import type { OpenChat } from './useChat';

export function ChatIllustrate({ chat }: { chat: OpenChat }) {
  const { illustrate, card, actions } = chat;
  const routes = drawingModels(useConnections());
  return (
    <Menu
      kind="dialog"
      size="form"
      place="above-start"
      label="삽화"
      trigger={(opener) => <ToolButton icon={ImageIcon} label="삽화" detail={illustrate.auto ? '자동 삽화 켜짐' : undefined} mark={illustrate.auto ? { kind: 'dot' } : undefined} {...opener} />}
    >
      <Stack gap="related">
        <SettingRow
          place="panel"
          label="자동 삽화"
          help="응답을 받을 때마다 삽화를 만들어요. 만들 때마다 이미지 연결의 사용량이 들어요."
          control={<Switch label="자동 삽화" checked={illustrate.auto} onChange={(auto) => actions.setIllustrate({ auto })} />}
        />
        <SettingRow
          place="panel"
          label="무료가 아니어도 만들기"
          help="무료 사용량을 다 썼거나 요금제에 무료 이미지가 없을 때도 묻지 않고 만들어요. 이때는 비용이 들어요."
          control={<Switch label="무료가 아니어도 만들기" checked={illustrate.spend} onChange={(spend) => actions.setIllustrate({ spend })} />}
        />
        <SettingRow
          place="panel"
          label="이미지 모델"
          sub={routes.length ? undefined : '이미지를 만들 모델이 없어요'}
          control={
            routes.length ? (
              <ImageModelMenu routes={routes} chat={chat} />
            ) : (
              <Button variant="ghost" size="sm" onClick={() => navigate({ kind: 'add-connection' })}>
                {newOf('연결')}
              </Button>
            )
          }
        />
        <SettingRow
          place="panel"
          label="삽화 프롬프트"
          control={<TaskPromptMenu task="illustrate" chosen={illustrate.prompt} heading={appliesTo(card, illustrate.own)} onPick={(prompt) => actions.setIllustrate({ prompt })} chat={chat} />}
        />
        {card && (
          <SettingRow
            place="panel"
            label="캐릭터별 설정"
            help={`켜면 ${card.name}의 채팅에만 이 설정을 적용해요.`}
            control={<Switch label="캐릭터별 설정" checked={illustrate.own} onChange={actions.setOwnIllustrate} />}
          />
        )}
        <Text variant="note">{appliesTo(card, illustrate.own)}</Text>
      </Stack>
    </Menu>
  );
}

// Without its own choice the switches draw with the first starred model that draws, and one no longer starred shows as
// missing, never as another model.
function ImageModelMenu({ routes, chat }: { routes: ImageRoute[]; chat: OpenChat }) {
  const { illustrate, card, actions } = chat;
  const own = illustrate.model;
  const choice = own ? routes.find(({ connection, model }) => sameModelRef(own, { connection: connection.id, model: model.id })) : routes[0];
  return (
    <Menu
      place="above-end"
      label="이미지 모델"
      trigger={(opener) => <ChipButton variant="field" opens="up" label={choice ? choice.model.name : NOT_STARRED} title="이미지 모델" tone={choice ? 'default' : 'warn'} {...opener} />}
    >
      <MenuHeading>{appliesTo(card, illustrate.own)}</MenuHeading>
      <MenuItem label={follows('첫 이미지 모델')} sub={routes[0]!.model.name} checked={!own} onClick={() => actions.setIllustrate({ model: undefined })} />
      {routes.map(({ connection, model }) => (
        <MenuItem
          key={`${connection.id}/${model.id}`}
          label={model.name}
          sub={connection.value.label}
          checked={!!own && sameModelRef(own, { connection: connection.id, model: model.id })}
          onClick={() => actions.setIllustrate({ model: { connection: connection.id, model: model.id } })}
        />
      ))}
    </Menu>
  );
}
