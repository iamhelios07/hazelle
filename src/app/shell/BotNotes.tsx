import { useEffect } from 'react';
import { aliased } from '../common/alias';
import { MODEL_ROLES } from '../common/words';
import { useScripts, useSession } from '../session';
import { useToast } from '../toast';

// What the bots' scripts say, each shown once as a notice. It stands in the shell, not in the chat screen: a script
// may speak for a chat that is not the one open.
export function BotNotes() {
  const { store, scripts } = useSession();
  const { notes } = useScripts();
  const toast = useToast();

  useEffect(() => {
    for (const note of notes) {
      scripts.seen(note.id);
      switch (note.kind) {
        case 'said': {
          const id = store.get('chat', note.chat)?.value.character;
          const character = id ? store.get('character', id)?.value : null;
          // Its chat or character was deleted while the script ran, and its words go with it.
          if (!id || !character) break;
          toast.said({ name: aliased(character.card.name, character.alias), face: store.children('avatar', id)[0]?.value.thumb ?? null }, note.text, note.tone === 'error' ? 'error' : 'plain');
          break;
        }
        case 'failed':
          toast.error('봇의 스크립트가 오류로 멈췄어요', { detail: note.message });
          break;
        case 'missing':
          toast.show('이 봇이 쓰는 기능 중 아직 없는 게 있어요', { detail: note.names.join(', ') });
          break;
        case 'stuck':
          toast.error('봇의 스크립트가 끝나지 않아 멈췄어요');
          break;
        case 'no-model':
          toast.error(`봇이 부르려는 ${MODEL_ROLES[note.role]}이 정해지지 않았어요`);
          break;
        case 'flood':
          toast.error('봇이 모델을 너무 자주 불러서 잠시 막았어요');
          break;
        case 'unsaved':
          toast.failed(note.failure, '봇이 바꾼 내용을 저장하지 못했어요');
          break;
      }
    }
  }, [notes]);

  return null;
}
