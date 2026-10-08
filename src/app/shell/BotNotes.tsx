import { useEffect } from 'react';
import { live } from '../../model/library';
import { aliased } from '../common/alias';
import { RUNAWAY_FIX } from '../common/failure';
import { BOT_STUCK, MODEL_ROLES, MODULE_VOICE } from '../common/words';
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
          const chat = live(store.get('chat', note.chat))?.value;
          const id = chat?.character ?? null;
          const character = id ? store.get('character', id)?.value : null;
          // Its chat or character was deleted while the script ran, and its words go with it.
          if (!chat || (id && !character)) break;
          // In a chat with no character only a module's script speaks.
          const from = id && character ? { name: aliased(character.card.name, character.alias), face: store.children('avatar', id)[0]?.value.thumb ?? null } : MODULE_VOICE;
          toast.said(from, note.text, note.tone === 'error' ? 'error' : 'plain');
          break;
        }
        case 'failed':
          toast.error('봇 스크립트가 오류로 멈췄어요', { detail: note.message });
          break;
        case 'missing':
          toast.show('이 봇이 쓰는 기능 중 지원하지 않는 게 있어요', { detail: note.names.join(', ') });
          break;
        case 'stuck':
          toast.error(BOT_STUCK);
          break;
        case 'runaway':
          toast.error('봇의 명령어가 텍스트를 너무 많이 만들어서 멈췄어요', { detail: RUNAWAY_FIX });
          break;
        case 'no-model':
          toast.error(`봇이 호출할 ${MODEL_ROLES[note.role]}이 없어요`);
          break;
        case 'no-character':
          toast.error('캐릭터 없는 채팅에서는 모듈이 모델을 호출할 수 없어요');
          break;
        case 'flood':
          toast.error('봇이 모델을 너무 자주 호출해서 잠시 막았어요');
          break;
        case 'unsaved':
          toast.failed(note.failure, '봇이 바꾼 내용을 저장하지 못했어요');
          break;
      }
    }
  }, [notes]);

  return null;
}
