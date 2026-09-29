import { useState } from 'react';
import type { ChatItem } from '../../model/chat';
import { KEEP_DAYS, type CharacterShelf } from '../../model/library';
import { copyCharacter, purgeCharacter, setDeleted } from '../../runtime/characters';
import { useFiles, useStore } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { describeStep } from './saving';
import { withChats } from './shelf';

type Shelf = CharacterShelf<ChatItem>;
export type CharacterActions = ReturnType<typeof useCharacterActions>;

// 사본 만들기, 지우기, 되살리기 and 지금 지우기, from the character page and from 캐릭터 둘러보기. busy is
// the character being copied or removed for good, and the step it is at.
export function useCharacterActions() {
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const [busy, setBusy] = useState<{ id: string; label: string } | null>(null);

  async function mark(id: string, at: number | null): Promise<boolean> {
    const saved = await setDeleted(store, id, at);
    if (!saved.ok) toast.failed(saved);
    return saved.ok;
  }

  async function copy({ id, character }: Shelf) {
    setBusy({ id, label: '사본 만드는 중' });
    const copied = await copyCharacter(store, files, id, `${character.card.name} (사본)`, (step) => setBusy({ id, label: describeStep(step) }));
    setBusy(null);
    if (!copied.ok) return toast.failed(copied, '사본을 만들지 못했어요.');
    toast.show('사본을 만들었어요. 사본을 고쳐도 원본은 그대로예요.');
    navigate({ kind: 'edit', character: copied.data });
  }

  // Whether it went to 지운 캐릭터.
  async function remove(shelf: Shelf): Promise<boolean> {
    const { id, character } = shelf;
    if (!(await mark(id, Date.now()))) return false;
    toast.undoable(`‘${character.card.name}’ ${withChats(shelf)} 지웠어요. ${KEEP_DAYS}일 안에는 ‘지운 캐릭터’에서 되살릴 수 있어요.`, () => void mark(id, null));
    return true;
  }

  async function restore({ id, character }: Shelf) {
    if (await mark(id, null)) toast.show(`‘${character.card.name}’ 캐릭터를 되살렸어요.`);
  }

  async function purge({ id, character }: Shelf) {
    setBusy({ id, label: '지우는 중' });
    const removed = await purgeCharacter(store, files, id, (done, total) => setBusy({ id, label: `지우는 중 · ${done} / ${total}` }));
    setBusy(null);
    if (removed.ok) toast.show(`‘${character.card.name}’ 캐릭터를 완전히 지웠어요.`);
    else toast.failed(removed, '다 지우지 못했어요.');
  }

  return { busy, copy, remove, restore, purge };
}
