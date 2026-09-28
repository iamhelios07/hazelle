import { useState } from 'react';
import type { ChatItem } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { copyCharacter, purgeCharacter } from '../../runtime/library';
import { navigate } from '../router';
import { useFiles, useStore } from '../session';
import { useToast } from '../toast';
import { describeFailure } from './failure';
import { describeStep } from './saving';
import { editPath } from './shelves';

type Shelf = CharacterShelf<ChatItem>;

// 사본 만들기, 지우기, 되살리기 and 지금 지우기, from the character page and from 캐릭터 둘러보기. busy is
// the character being copied or removed for good, and the step it is at.
export function useCharacterActions() {
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const [busy, setBusy] = useState<{ id: string; label: string } | null>(null);

  // deleted undefined brings it back from 지운 캐릭터.
  async function mark(id: string, deleted: number | undefined): Promise<boolean> {
    const saved = await store.update('character', id, (current) => {
      const next = { ...current };
      if (deleted === undefined) delete next.deleted;
      else next.deleted = deleted;
      return next;
    });
    if (!saved.ok) toast({ message: describeFailure(saved) });
    return saved.ok;
  }

  async function copy({ id, character }: Shelf) {
    setBusy({ id, label: '사본 만드는 중' });
    const copied = await copyCharacter(store, files, id, `${character.card.name} (사본)`, (step) => setBusy({ id, label: describeStep(step) }));
    setBusy(null);
    if (!copied.ok) return toast({ message: `사본을 만들지 못했어요. ${describeFailure(copied)}` });
    toast({ message: '사본을 만들었어요. 사본을 고쳐도 원본은 그대로예요.' });
    navigate(editPath(copied.data));
  }

  // Whether it went to 지운 캐릭터, where it and its chats wait KEEP_DELETED before going for good.
  async function remove({ id, character, chats }: Shelf): Promise<boolean> {
    if (!(await mark(id, Date.now()))) return false;
    const what = chats.length ? `캐릭터와 채팅 ${chats.length}개를` : '캐릭터를';
    toast({
      message: `‘${character.card.name}’ ${what} 지웠어요. 7일 안에는 ‘지운 캐릭터’에서 되살릴 수 있어요.`,
      action: { label: '되돌리기', onClick: () => void mark(id, undefined) },
    });
    return true;
  }

  async function restore({ id, character }: Shelf) {
    if (await mark(id, undefined)) toast({ message: `‘${character.card.name}’ 캐릭터를 되살렸어요.` });
  }

  async function purge({ id, character }: Shelf) {
    setBusy({ id, label: '지우는 중' });
    const removed = await purgeCharacter(store, files, id, (done, total) => setBusy({ id, label: `지우는 중 · ${done} / ${total}` }));
    setBusy(null);
    toast({ message: removed.ok ? `‘${character.card.name}’ 캐릭터를 완전히 지웠어요.` : `다 지우지 못했어요. ${describeFailure(removed)}` });
  }

  return { busy, copy, remove, restore, purge };
}
