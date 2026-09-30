import { Languages } from 'lucide-react';
import { useState } from 'react';
import { ofSort, translationPrompt } from '../../runtime/prompts';
import { describeTranslateFailure } from '../common/failure';
import { LANGUAGES, languageLabel } from '../common/languages';
import { useSession, useSettings, useViews } from '../session';
import { navigate } from '../shell/router';
import { Button, ChipButton, Divider, Menu, MenuHeading, MenuItem, Row, SettingRow, Stack, Switch, Tag, Text, TextField, ToolButton, useMenuClose } from '../ui';
import type { OpenChat } from './useChat';

export function ChatTranslate({ chat }: { chat: OpenChat }) {
  const { translate, translateModel, card, actions } = chat;
  // Without a character the other side is the model itself.
  const theirs = card ? `${card.name}의 언어` : '모델 언어';
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
          control={<Switch label="답장 번역" checked={translate.replies} onChange={(replies) => actions.setTranslate({ replies })} />}
        />
        <SettingRow
          place="panel"
          label="보낼 말 번역"
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
        <SettingRow place="panel" label="내 언어" control={<LanguageMenu label="내 언어" value={translate.mine} onPick={(mine) => actions.setTranslate({ mine })} />} />
        <SettingRow place="panel" label={theirs} control={<LanguageMenu label={theirs} value={translate.theirs} onPick={(language) => actions.setTranslate({ theirs: language })} />} />
        <SettingRow place="panel" label="번역 프롬프트" control={<PromptMenu chat={chat} />} />
        <SettingRow
          place="panel"
          label="번역 모델"
          control={
            <Button variant="link" size="sm" onClick={() => navigate({ kind: 'defaults' })}>
              {'kind' in translateModel ? describeTranslateFailure(translateModel) : translateModel.model.name}
            </Button>
          }
        />
        <Text size="sm" tone="muted">
          {card ? `${card.name}의 모든 채팅에 적용돼요.` : '캐릭터 없이 하는 모든 채팅에 적용돼요.'}
        </Text>
      </Stack>
    </Menu>
  );
}

function LanguageMenu({ label, value, onPick }: { label: string; value: string; onPick: (name: string) => void }) {
  return (
    <Menu kind="dialog" place="above-end" label={label} trigger={(opener) => <ChipButton variant="field" opens="up" label={languageLabel(value)} title={label} {...opener} />}>
      <LanguageChoices label={label} value={value} onPick={onPick} />
    </Menu>
  );
}

// Mounted only while the menu is open, so a language typed and left starts empty again.
function LanguageChoices({ label, value, onPick }: { label: string; value: string; onPick: (name: string) => void }) {
  const close = useMenuClose();
  const [typed, setTyped] = useState('');
  const pick = (name: string) => {
    onPick(name);
    close();
  };
  return (
    <>
      {LANGUAGES.map((language) => (
        <MenuItem key={language.name} label={language.label} checked={language.name === value} onClick={() => pick(language.name)} />
      ))}
      <Divider variant="menu" />
      <TextField label="다른 언어" value={typed} onChange={setTyped} placeholder="예: Ukrainian" help={`목록에 없는 언어는 영어 이름으로 써요. 번역 프롬프트의 {{language}}에 그대로 들어가요.`} />
      <Row kind="actions">
        <Button size="sm" disabled={!typed.trim()} onClick={() => pick(typed.trim())}>
          {`${label}로 쓰기`}
        </Button>
      </Row>
    </>
  );
}

// Without its own choice the character follows the default translation prompt live, and a deleted one shows as
// missing, never as another prompt.
function PromptMenu({ chat }: { chat: OpenChat }) {
  const { translate, actions } = chat;
  const { store } = useSession();
  const settings = useSettings();
  const prompts = useViews()
    .prompts.filter((each) => ofSort(each, 'translate'))
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
      <MenuHeading>이 캐릭터의 모든 채팅에 적용돼요</MenuHeading>
      <MenuItem label="기본 번역 프롬프트 따르기" sub={fallback?.value.name ?? '기본 번역 프롬프트가 없어요'} checked={translate.prompt === undefined} onClick={() => actions.setTranslate({ prompt: undefined })} />
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
      {choice.kind === 'prompt' && <MenuItem label="이 프롬프트 고치기…" onClick={() => actions.side({ kind: 'prompts', id: choice.prompt.id, pane: null })} />}
      <MenuItem label="프롬프트 관리…" onClick={() => actions.side({ kind: 'prompts', id: null, pane: null })} />
    </Menu>
  );
}
