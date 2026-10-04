import { setTranslatorNote } from '../../runtime/characters';
import { useAutosave } from '../common/useAutosave';
import { NOTE_PLACEHOLDER, TRANSLATOR_NOTE } from '../common/words';
import { useSettings, useStore } from '../session';
import { Section, TextField } from '../ui';

export function TranslationDefaults() {
  const store = useStore();
  const settings = useSettings();
  const save = useAutosave<{ note: string }>('translator-note', ({ note = '' }) => setTranslatorNote(store, null, note));
  return (
    <Section title="번역">
      <TextField
        label={TRANSLATOR_NOTE}
        lines={6}
        value={save.unsaved.note ?? settings.translatorNote ?? ''}
        onChange={(note) => save.change({ note })}
        placeholder={NOTE_PLACEHOLDER}
        help="모든 캐릭터의 번역 프롬프트에 들어가요. 캐릭터만의 것은 캐릭터 편집에서 적어요."
      />
    </Section>
  );
}
