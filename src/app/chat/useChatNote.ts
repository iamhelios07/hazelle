import { useState } from 'react';
import { saveWords, useAutosave } from '../common/useAutosave';
import type { ChatSettingsActions } from './useChatSettings';

const UNSAVED_CHAT = '첫 메시지를 보내면 저장돼요';

// A chat's own note typed in a box, mounted while the box is open so it starts from what is saved. An unsaved chat
// holds the note itself until its first send, so only a saved one goes through autosave. none: what a blank box
// stores; null leaves the chat without a note of its own. following: the text the box shows then.
export function useChatNote(key: string, id: string | null, note: string | undefined, onSave: ChatSettingsActions['setNote'], none: '' | null, following: string) {
  const autosave = useAutosave<{ note: string | null }>(`${key}:${id}`, (patch) => onSave(patch.note ?? null));
  // A save still on its way from the box opened before is newer than what is stored.
  const [text, setText] = useState(('note' in autosave.unsaved ? autosave.unsaved.note : note) ?? following);

  const own = 'note' in autosave.unsaved ? autosave.unsaved.note !== null : note !== undefined;
  return {
    text,
    own,
    status: !id ? (own ? UNSAVED_CHAT : '') : own || autosave.status === 'failed' ? saveWords(autosave.status ?? 'saved') : '',
    change: (value: string) => {
      setText(value);
      const stored = value.trim() ? value : none;
      if (!id) return void onSave(stored);
      autosave.change({ note: stored });
    },
    follow: () => {
      setText(following);
      if (!id) return void onSave(null);
      void autosave.save({ note: null });
    },
  };
}
