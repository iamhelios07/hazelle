import { Languages } from 'lucide-react';
import { sendsNotes, type translatorOf } from '../../runtime/translate';
import { PerCharacter, type PromptDoor } from '../common/TaskPrompt';
import { TranslateRows } from '../common/TranslateRows';
import { inFeature, NOTE_UNSENT, noteLines, opens, scopeTag, TRANSLATOR_NOTE } from '../common/words';
import { useSettings } from '../session';
import { navigate } from '../shell/router';
import { Button, Divider, Menu, Section, SettingRow, Stack, ToolButton } from '../ui';
import type { TranslateSetup } from '../../runtime/characters';
import type { TranslationActions } from './useChatTranslation';

type Translator = ReturnType<typeof translatorOf>;
type Props = {
  translate: TranslateSetup;
  translation: Translator;
  card: { name: string } | null;
  note: string | undefined;
  onChange: TranslationActions['setTranslate'];
  onOwnChange: TranslationActions['setOwnTranslate'];
  onEditPrompt: (door: PromptDoor) => void;
  onEditCharacter: (() => void) | undefined;
};

export function ChatTranslate({ translate, translation, card, note, onChange, onOwnChange, onEditPrompt, onEditCharacter }: Props) {
  const on = [translate.replies && '응답 번역', translate.input && '내 메시지 번역', translate.reverse && '반전 모드'].filter(Boolean).join(', ');
  return (
    <Menu
      kind="dialog"
      size="form"
      place="above-start"
      label="번역"
      trigger={(opener) => <ToolButton icon={Languages} label="번역" phone="icon" detail={on ? `${on} 켜짐` : undefined} mark={on ? { kind: 'dot' } : undefined} {...opener} />}
    >
      <Section level={3} title="번역" tag={scopeTag(card && translate.own ? 'character' : 'default')}>
        <Stack gap="related">
          <TranslateRows
            translate={translate}
            translation={translation}
            card={card}
            note={
              <>
                <Divider variant="menu" />
                <NoteRow note={note} translation={translation} onEdit={onEditCharacter} />
              </>
            }
            opens="up"
            onChange={onChange}
            onEditPrompt={onEditPrompt}
          />
          <PerCharacter card={card} own={translate.own} onChange={onOwnChange} />
        </Stack>
      </Section>
    </Menu>
  );
}

function NoteRow({ note, translation, onEdit }: { note: string | undefined; translation: Translator; onEdit: (() => void) | undefined }) {
  const global = noteLines(useSettings().translatorNote);
  const own = noteLines(note);
  const counts = [global > 0 && `전역 ${global}줄`, own && `캐릭터 ${own}줄`].filter(Boolean).join(' · ');
  const unsent = counts !== '' && translation.ok && !sendsNotes(translation.prompt);
  return (
    <SettingRow
      label={TRANSLATOR_NOTE}
      help={{ text: '전역 노트는 모든 번역에 들어가고, 캐릭터 노트는 이 캐릭터를 번역할 때만 들어가요.', open: { label: opens(inFeature('translate')), onClick: () => navigate({ kind: 'feature', feature: 'translate' }) } }}
      sub={counts || '없음'}
      error={unsent ? NOTE_UNSENT : undefined}
      control={
        onEdit && (
          <Button variant="ghost" size="sm" onClick={onEdit}>
            캐릭터 편집
          </Button>
        )
      }
    />
  );
}
