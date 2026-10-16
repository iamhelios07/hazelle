import type { ReactNode } from 'react';
import type { TranslateSwitches } from '../../model/chat';
import type { TranslateSetup } from '../../runtime/characters';
import { translationPrompt } from '../../runtime/prompts';
import type { translatorOf } from '../../runtime/translate';
import { useSession } from '../session';
import { SettingRow, Switch, Text } from '../ui';
import { describeTranslateFailure } from './failure';
import { IntoLanguage } from './IntoLanguage';
import { appliesTo, TaskPromptMenu } from './TaskPrompt';
import { opens as door, PAGES, taskModelHelp } from './words';

type Props = {
  translate: TranslateSetup;
  translation: ReturnType<typeof translatorOf>;
  card: { name: string } | null;
  // The chat's 번역가의 노트 row with its divider. 채팅 기본값's 번역 page edits the 전역 note under these rows instead.
  note?: ReactNode;
  opens: 'up' | 'down';
  onChange: (change: Partial<TranslateSwitches>) => void;
  onEditPrompt: (id: string | null) => void;
};

// 번역's shared values, the same rows in the chat's 번역 dialog and on 채팅 기본값's 번역 page.
export function TranslateRows({ translate, translation, card, note, opens, onChange, onEditPrompt }: Props) {
  const { store } = useSession();
  const prompt = translationPrompt(store, translate.prompt);
  return (
    <>
      <SettingRow
        label="응답 번역"
        sentence={<IntoLanguage before="응답을" after="번역해서 보기" label="응답 번역 언어" value={translate.replyLanguage} opens={opens} onPick={(replyLanguage) => onChange({ replyLanguage })} />}
        control={<Switch label="응답 번역" checked={translate.replies} onChange={(replies) => onChange({ replies })} />}
      />
      <SettingRow
        label="내 메시지 번역"
        sentence={<IntoLanguage before="내 메시지를" after="번역해서 보내기" label="내 메시지 번역 언어" value={translate.inputLanguage} opens={opens} onPick={(inputLanguage) => onChange({ inputLanguage })} />}
        sub={translate.reverse ? '반전 모드에서는 원문으로 보내요' : undefined}
        control={<Switch label="내 메시지 번역" checked={translate.input} disabled={translate.reverse} onChange={(input) => onChange({ input })} />}
      />
      <SettingRow
        label="반전 모드"
        help="모델에게도 화면에 보이는 내용 그대로 보내요."
        control={<Switch label="반전 모드" checked={translate.reverse} onChange={(reverse) => onChange({ reverse })} />}
      />
      {note}
      <SettingRow
        label="번역 프롬프트"
        control={<TaskPromptMenu task="translate" chosen={translate.prompt} heading={appliesTo(card, translate.own)} opens={opens} onPick={(prompt) => onChange({ prompt })} onEdit={onEditPrompt} />}
      />
      <SettingRow
        label="번역 모델"
        help={{
          text: taskModelHelp('번역'),
          open: prompt.kind === 'prompt' ? { label: door('번역 프롬프트'), onClick: () => onEditPrompt(prompt.prompt.id) } : { label: door(PAGES.prompts), onClick: () => onEditPrompt(null) },
        }}
        control={<Text variant="note">{translation.ok ? translation.route.model.name : describeTranslateFailure(translation.failure)}</Text>}
      />
    </>
  );
}
