import { setTranslatorNote } from '../../runtime/characters';
import { useAutosave } from '../common/useAutosave';
import { NOTE_PLACEHOLDER, TRANSLATOR_NOTE } from '../common/words';
import { useSettings, useStore } from '../session';
import { TextField } from '../ui';

export function GlobalNoteField({ error }: { error?: string }) {
  const store = useStore();
  const settings = useSettings();
  const save = useAutosave<{ note: string }>('translator-note', ({ note = '' }) => setTranslatorNote(store, null, note));
  return (
    <TextField
      label={TRANSLATOR_NOTE}
      lines={6}
      value={save.unsaved.note ?? settings.translatorNote ?? ''}
      onChange={(note) => save.change({ note })}
      placeholder={NOTE_PLACEHOLDER}
      help="모든 캐릭터의 번역에 적용돼요."
      error={error}
    />
  );
}
