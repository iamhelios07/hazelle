import { Languages } from 'lucide-react';
import { ofSort, translationPrompt } from '../../runtime/prompts';
import { describeTranslateFailure } from '../common/failure';
import { IntoLanguage } from '../common/IntoLanguage';
import { follows, inSettings, TRANSLATION_MODEL_HELP, TRANSLATOR_NOTE } from '../common/words';
import { useSession, useSettings, usePrompts } from '../session';
import { Button, ChipButton, Divider, Menu, MenuHeading, MenuItem, SettingRow, Stack, Switch, Tag, Text, ToolButton } from '../ui';
import type { OpenChat } from './useChat';

const appliesTo = (card: OpenChat['card'], own: boolean) => (card && own ? `${card.name}의 채팅에만 적용돼요.` : '따로 정한 캐릭터 말고 모든 채팅에 적용돼요.');

export function ChatTranslate({ chat }: { chat: OpenChat }) {
  const { translate, translation, card, actions } = chat;
  const on = [translate.replies && '답장 번역', translate.input && '보낼 말 번역', translate.reverse && '반전 모드'].filter(Boolean).join(', ');
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
          sentence={<IntoLanguage before="답장을" after="번역해서 보기" label="답장 번역 언어" value={translate.replyLanguage} opens="up" onPick={(replyLanguage) => actions.setTranslate({ replyLanguage })} />}
          control={<Switch label="답장 번역" checked={translate.replies} onChange={(replies) => actions.setTranslate({ replies })} />}
        />
        <SettingRow
          place="panel"
          label="보낼 말 번역"
          sentence={<IntoLanguage before="내 말을" after="번역해서 보내기" label="보낼 말 번역 언어" value={translate.inputLanguage} opens="up" onPick={(inputLanguage) => actions.setTranslate({ inputLanguage })} />}
          sub={translate.reverse ? '반전 모드에서는 쓴 말 그대로 보내요' : undefined}
          control={<Switch label="보낼 말 번역" checked={translate.input} disabled={translate.reverse} onChange={(input) => actions.setTranslate({ input })} />}
        />
        <SettingRow
          place="panel"
          label="반전 모드"
          help="모델에게도 화면에 보이는 글을 보내요. 답장은 번역으로, 내 말은 내가 쓴 그대로 가요."
          control={<Switch label="반전 모드" checked={translate.reverse} onChange={(reverse) => actions.setTranslate({ reverse })} />}
        />
        <Divider variant="menu" />
        <NoteRow chat={chat} />
        <SettingRow place="panel" label="번역 프롬프트" control={<PromptMenu chat={chat} />} />
        <SettingRow
          place="panel"
          label="번역 모델"
          help={TRANSLATION_MODEL_HELP}
          control={
            <Text variant="note">
              {translation.ok ? translation.route.model.name : describeTranslateFailure(translation.failure)}
            </Text>
          }
        />
        {card && (
          <SettingRow
            place="panel"
            label="이 캐릭터만 따로"
            help={`켜면 ${card.name}의 채팅은 지금 설정을 따로 갖고, 다른 채팅에서 바꿔도 그대로예요. 끄면 다시 모든 채팅과 같은 설정을 따라요.`}
            control={<Switch label="이 캐릭터만 따로" checked={translate.own} onChange={actions.setOwnTranslate} />}
          />
        )}
        <Text variant="note">
          {appliesTo(card, translate.own)}
        </Text>
      </Stack>
    </Menu>
  );
}

const lineCount = (note: string | undefined) => (note ?? '').split('\n').filter((line) => line.trim()).length;

function NoteRow({ chat }: { chat: OpenChat }) {
  const { shelf, translation, actions } = chat;
  const global = lineCount(useSettings().translatorNote);
  const own = shelf && lineCount(shelf.character.translatorNote);
  const counts = [global > 0 && `전역 ${global}줄`, own && `캐릭터 ${own}줄`].filter(Boolean).join(' · ');
  // A prompt made before the slot existed, the stored 기본 번역 among them, sends no note until the user adds the block.
  const unsent = counts !== '' && translation.ok && !translation.prompt.blocks.some((block) => block.kind === 'slot' && block.slot === 'note');
  return (
    <SettingRow
      place="panel"
      label={TRANSLATOR_NOTE}
      help={`번역할 때 이름과 용어를 늘 같게 옮기도록 적어 두는 메모예요. 전역 노트는 ${inSettings('chat')}, 캐릭터 노트는 캐릭터 편집에 있어요.`}
      sub={counts || '없음'}
      error={unsent ? `번역 프롬프트에 ‘${TRANSLATOR_NOTE}’ 블록이 없어서 보내지 않아요. 프롬프트에서 넣어 주세요.` : undefined}
      control={
        shelf && (
          <Button variant="ghost" size="sm" onClick={() => actions.side({ kind: 'character', id: shelf.id })}>
            캐릭터 편집
          </Button>
        )
      }
    />
  );
}

// Without its own choice the switches follow the default translation prompt live, and a deleted one shows as
// missing, never as another prompt.
function PromptMenu({ chat }: { chat: OpenChat }) {
  const { translate, card, actions } = chat;
  const { store } = useSession();
  const settings = useSettings();
  const prompts = usePrompts()
    .filter((each) => ofSort(each, 'translate'))
    .sort((a, b) => a.value.name.localeCompare(b.value.name, 'ko'));
  const choice = translationPrompt(store, translate.prompt);
  const fallback = prompts.find(({ id }) => id === settings.translatePrompt);
  const label = choice.kind === 'prompt' ? choice.prompt.value.name : choice.own ? '프롬프트가 지워졌어요' : '기본 번역 프롬프트가 없어요';
  return (
    <Menu
      place="above-end"
      label="번역 프롬프트"
      trigger={(opener) => <ChipButton variant="field" opens="up" label={label} title="번역 프롬프트" tone={choice.kind === 'missing' ? 'warn' : 'default'} {...opener} />}
    >
      <MenuHeading>{appliesTo(card, translate.own)}</MenuHeading>
      <MenuItem label={follows('기본 번역 프롬프트')} sub={fallback?.value.name ?? '기본 번역 프롬프트가 없어요'} checked={translate.prompt === undefined} onClick={() => actions.setTranslate({ prompt: undefined })} />
      {prompts.map((item) => (
        <MenuItem
          key={item.id}
          label={item.value.name}
          tag={item.id === settings.translatePrompt ? <Tag tone="accent">기본</Tag> : undefined}
          checked={item.id === translate.prompt}
          onClick={() => actions.setTranslate({ prompt: item.id })}
        />
      ))}
      <Divider variant="menu" />
      {choice.kind === 'prompt' && <MenuItem label="이 프롬프트 편집…" onClick={() => actions.side({ kind: 'prompts', id: choice.prompt.id, pane: null })} />}
      <MenuItem label="프롬프트 관리…" onClick={() => actions.side({ kind: 'prompts', id: null, pane: null })} />
    </Menu>
  );
}
