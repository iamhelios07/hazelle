import { useState } from 'react';
import type { ChatSummary } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import { copyCharacter, markDeleted, purgeNow, setDeleted } from '../../runtime/characters';
import { BIN_KEEPS } from '../common/words';
import { useStore } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { describeStep } from './saving';
import { withChats } from './shelf';

type Shelf = CharacterShelf<ChatSummary>;
export type CharacterActions = ReturnType<typeof useCharacterActions>;
// A character or a chat in 휴지통, named as its toasts name it. what is all that 지금 지우기 takes, as the object of
// 지워요.
export type Binned = { kind: 'character' | 'chat'; id: string; name: string; what: string };
const OBJECT = { character: '캐릭터를', chat: '채팅을' };

export const binnedCharacter = (shelf: Shelf): Binned => {
  const name = shelf.character.card.name;
  return { kind: 'character', id: shelf.id, name, what: `‘${name}’ ${withChats(shelf)}` };
};

export const binnedChat = ({ id, title }: ChatSummary): Binned => ({ kind: 'chat', id, name: title, what: `‘${title}’ ${OBJECT.chat}` });

// A character's 사본 만들기 and 지우기, from the character page and from 캐릭터 둘러보기, and 되살리기 and 지금 지우기
// of what is in 휴지통. busy is the character being copied, or what is being removed for good, and the step it is at.
export function useCharacterActions() {
  const store = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState<{ id: string; label: string } | null>(null);

  async function mark(id: string, at: number | null): Promise<boolean> {
    const saved = await setDeleted(store, id, at);
    if (!saved.ok) toast.failed(saved);
    return saved.ok;
  }

  async function copy({ id, character }: Shelf) {
    setBusy({ id, label: '사본 만드는 중' });
    const copied = await copyCharacter(store, id, `${character.card.name} (사본)`, (step) => setBusy({ id, label: describeStep(step) }));
    setBusy(null);
    if (!copied.ok) return toast.failed(copied, '사본을 만들지 못했어요.');
    toast.show('사본을 만들었어요.', { detail: '사본을 고쳐도 원본은 그대로예요.' });
    navigate({ kind: 'edit', character: copied.data });
  }

  // Whether it went to 휴지통.
  async function remove(shelf: Shelf): Promise<boolean> {
    const { id, character } = shelf;
    if (!(await mark(id, Date.now()))) return false;
    toast.undoable(`‘${character.card.name}’ ${withChats(shelf)} 지웠어요.`, () => void mark(id, null), BIN_KEEPS);
    return true;
  }

  async function restore({ kind, id, name }: Binned) {
    const saved = await markDeleted(store, kind, id, null);
    if (saved.ok) toast.show(`‘${name}’ ${OBJECT[kind]} 되살렸어요.`);
    else toast.failed(saved);
  }

  async function purge({ kind, id, name }: Binned) {
    setBusy({ id, label: '지우는 중' });
    const removed = await purgeNow(store, kind, id, (done, total) => setBusy({ id, label: `지우는 중 · ${done} / ${total}` }));
    setBusy(null);
    if (removed.ok) toast.show(`‘${name}’ ${OBJECT[kind]} 완전히 지웠어요.`);
    else toast.failed(removed, '다 지우지 못했어요.');
  }

  return { busy, copy, remove, restore, purge };
}
