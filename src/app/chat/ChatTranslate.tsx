import { Languages } from 'lucide-react';
import { sendsNotes } from '../../runtime/translate';
import { describeTranslateFailure } from '../common/failure';
import { IntoLanguage } from '../common/IntoLanguage';
import { inSettings, NOTE_UNSENT, noteLines, TRANSLATION_MODEL_HELP, TRANSLATOR_NOTE } from '../common/words';
import { useSettings } from '../session';
import { Button, Divider, Menu, SettingRow, Stack, Switch, Text, ToolButton } from '../ui';
import { appliesTo, PerCharacter, TaskPromptMenu } from './ChatTaskPrompt';
import type { OpenChat } from './useChat';

export function ChatTranslate({ chat }: { chat: OpenChat }) {
  const { translate, translation, card, actions } = chat;
  const on = [translate.replies && '응답 번역', translate.input && '내 메시지 번역', translate.reverse && '반전 모드'].filter(Boolean).join(', ');
  return (
    <Menu
      kind="dialog"
      size="form"
      place="above-start"
      label="번역"
      trigger={(opener) => <ToolButton icon={Languages} label="번역" phone="icon" detail={on ? `${on} 켜짐` : undefined} mark={on ? { kind: 'dot' } : undefined} {...opener} />}
    >
      <Stack gap="related">
        <SettingRow
          label="응답 번역"
          sentence={<IntoLanguage before="응답을" after="번역해서 보기" label="응답 번역 언어" value={translate.replyLanguage} opens="up" onPick={(replyLanguage) => actions.setTranslate({ replyLanguage })} />}
          control={<Switch label="응답 번역" checked={translate.replies} onChange={(replies) => actions.setTranslate({ replies })} />}
        />
        <SettingRow
          label="내 메시지 번역"
          sentence={<IntoLanguage before="내 메시지를" after="번역해서 보내기" label="내 메시지 번역 언어" value={translate.inputLanguage} opens="up" onPick={(inputLanguage) => actions.setTranslate({ inputLanguage })} />}
          sub={translate.reverse ? '반전 모드에서는 원문으로 보내요' : undefined}
          control={<Switch label="내 메시지 번역" checked={translate.input} disabled={translate.reverse} onChange={(input) => actions.setTranslate({ input })} />}
        />
        <SettingRow
          label="반전 모드"
          help="모델에게도 화면에 보이는 내용을 보내요."
          control={<Switch label="반전 모드" checked={translate.reverse} onChange={(reverse) => actions.setTranslate({ reverse })} />}
        />
        <Divider variant="menu" />
        <NoteRow chat={chat} />
        <SettingRow
          label="번역 프롬프트"
          control={<TaskPromptMenu task="translate" chosen={translate.prompt} heading={appliesTo(card, translate.own)} onPick={(prompt) => actions.setTranslate({ prompt })} chat={chat} />}
        />
        <SettingRow
          label="번역 모델"
          help={TRANSLATION_MODEL_HELP}
          control={
            <Text variant="note">
              {translation.ok ? translation.route.model.name : describeTranslateFailure(translation.failure)}
            </Text>
          }
        />
        <PerCharacter card={card} own={translate.own} onChange={actions.setOwnTranslate} />
      </Stack>
    </Menu>
  );
}

function NoteRow({ chat }: { chat: OpenChat }) {
  const { shelf, translation, actions } = chat;
  const global = noteLines(useSettings().translatorNote);
  const own = shelf && noteLines(shelf.character.translatorNote);
  const counts = [global > 0 && `전역 ${global}줄`, own && `캐릭터 ${own}줄`].filter(Boolean).join(' · ');
  const unsent = counts !== '' && translation.ok && !sendsNotes(translation.prompt);
  return (
    <SettingRow
      label={TRANSLATOR_NOTE}
      help={`전역 노트는 ${inSettings('chat')}, 캐릭터 노트는 캐릭터 편집에서 수정해요.`}
      sub={counts || '없음'}
      error={unsent ? NOTE_UNSENT : undefined}
      control={
        shelf && (
          <Button variant="ghost" size="sm" onClick={() => actions.side({ kind: 'character', id: shelf.id, part: 'instructions' })}>
            캐릭터 편집
          </Button>
        )
      }
    />
  );
}
