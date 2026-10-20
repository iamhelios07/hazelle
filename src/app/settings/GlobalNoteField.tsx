import { setTranslatorNote } from '../../runtime/characters';
import { TranslatorNoteField } from '../common/TranslatorNoteField';
import { useSettings, useStore } from '../session';

export function GlobalNoteField({ error }: { error?: string }) {
  const store = useStore();
  const settings = useSettings();
  return <TranslatorNoteField saveKey="translator-note" stored={settings.translatorNote} write={(note) => setTranslatorNote(store, null, note)} help="모든 캐릭터의 번역에 적용돼요." error={error} />;
}
