import { useState } from 'react';
import type { ChatSummary } from '../../model/chat';
import type { Stored } from '../../model/kinds';
import type { CharacterShelf, Removable } from '../../model/library';
import { copyCharacter, setDeleted } from '../../runtime/characters';
import { markDeleted, purgeNow } from '../../runtime/removal';
import { BIN_KEEPS, moduleName, promptName } from '../common/words';
import { useStore } from '../session';
import { navigate } from '../shell/router';
import { useToast } from '../toast';
import { describeStep } from './saving';
import { withChats } from './shelf';

type Shelf = CharacterShelf<ChatSummary>;
export type CharacterActions = ReturnType<typeof useCharacterActions>;
// what is all that 영구 삭제 takes, as the object of 영구 삭제해요.
export type Binned = { kind: Removable; id: string; name: string; what: string };
const OBJECT: Record<Removable, string> = { character: '캐릭터를', chat: '채팅을', module: '모듈을', prompt: '프롬프트를', persona: '페르소나를', profile: '모델 설정을' };
const one = (kind: Exclude<Removable, 'character' | 'chat'>, id: string, name: string): Binned => ({ kind, id, name, what: `'${name}' ${OBJECT[kind]}` });

export const binnedCharacter = (shelf: Shelf): Binned => {
  const name = shelf.character.card.name;
  return { kind: 'character', id: shelf.id, name, what: `'${name}' ${withChats(shelf)}` };
};

export const binnedChat = ({ id, title }: ChatSummary): Binned => ({ kind: 'chat', id, name: title, what: `'${title}' ${OBJECT.chat}` });
export const binnedModule = ({ id, value }: Stored<'module'>): Binned => one('module', id, moduleName(value.name));
export const binnedPrompt = ({ id, value }: Stored<'prompt'>): Binned => one('prompt', id, promptName(value.name));
export const binnedPersona = ({ id, value }: Stored<'persona'>): Binned => one('persona', id, value.name);
export const binnedProfile = ({ id, value }: Stored<'profile'>): Binned => one('profile', id, value.name);

export function useCharacterActions() {
  const store = useStore();
  const toast = useToast();
  const [busy, setBusy] = useState<{ id: string; label: string } | null>(null);

  function mark(id: string, at: number | null) {
    void setDeleted(store, id, at).then((saved) => saved.ok || toast.failed(saved));
  }

  async function copy({ id, character }: Shelf) {
    setBusy({ id, label: '사본 만드는 중' });
    const copied = await copyCharacter(store, id, `${character.card.name} (사본)`, (step) => setBusy({ id, label: describeStep(step) }));
    setBusy(null);
    if (!copied.ok) return toast.failed(copied, '사본을 만들지 못했어요.');
    toast.show('사본을 만들었어요.');
    navigate({ kind: 'edit', character: copied.data });
  }

  function remove(shelf: Shelf) {
    const { id, character } = shelf;
    mark(id, Date.now());
    toast.undoable(`'${character.card.name}' ${withChats(shelf)} 삭제했어요.`, () => mark(id, null), BIN_KEEPS);
  }

  function restore({ kind, id, name }: Binned) {
    void markDeleted(store, kind, id, null).then((saved) => saved.ok || toast.failed(saved));
    toast.show(`'${name}' ${OBJECT[kind]} 복원했어요.`);
  }

  async function purge({ kind, id, name }: Binned) {
    setBusy({ id, label: '삭제 중' });
    const removed = await purgeNow(store, kind, id, (done, total) => setBusy({ id, label: `삭제 중 · ${done} / ${total}` }));
    setBusy(null);
    if (removed.ok) toast.show(`'${name}' ${OBJECT[kind]} 영구 삭제했어요.`);
    else toast.failed(removed, '일부를 삭제하지 못했어요.');
  }

  return { busy, copy, remove, restore, purge };
}
