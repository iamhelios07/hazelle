import { Languages } from 'lucide-react';
import { describeTranslateFailure } from '../common/failure';
import { Menu, SettingRow, Stack, Switch, Text, ToolButton } from '../ui';
import type { OpenChat } from './useChat';

export function ChatTranslate({ chat }: { chat: OpenChat }) {
  const { translate, translateModel, card, actions } = chat;
  const on = [translate.replies && '답장 번역', translate.input && '보낼 말 번역'].filter(Boolean).join(', ');
  return (
    <Menu
      kind="dialog"
      size="form"
      place="above-start"
      label="번역"
      trigger={(opener) => <ToolButton icon={Languages} label="번역" detail={on ? `${on} 켜짐` : undefined} mark={on ? { kind: 'dot' } : undefined} {...opener} />}
    >
      <Stack gap="related">
        <SettingRow
          place="panel"
          label="답장 번역"
          help="답장이 끝나면 한국어로 옮겨 보여 줘요. 모델에게는 원문이 가요."
          control={<Switch label="답장 번역" checked={translate.replies} onChange={(replies) => actions.setTranslate({ ...translate, replies })} />}
        />
        <SettingRow
          place="panel"
          label="보낼 말 번역"
          help="쓴 말을 영어로 옮겨 보내요. 채팅에는 쓴 말이 보여요."
          control={<Switch label="보낼 말 번역" checked={translate.input} onChange={(input) => actions.setTranslate({ ...translate, input })} />}
        />
        <Text size="sm" tone="muted">
          {'kind' in translateModel ? describeTranslateFailure(translateModel) : `번역 모델 · ${translateModel.model.name}`}
        </Text>
        <Text size="sm" tone="muted">
          {card ? `${card.name}의 모든 채팅에 적용돼요.` : '캐릭터 없이 하는 모든 채팅에 적용돼요.'}
        </Text>
      </Stack>
    </Menu>
  );
}
