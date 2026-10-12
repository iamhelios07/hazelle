import { useState } from 'react';
import type { ChatSummary } from '../../model/chat';
import type { Stored } from '../../model/kinds';
import type { CharacterShelf, Removable } from '../../model/library';
import { exportCharacter } from '../../runtime/card-file';
import { copyCharacter, createCharacter, setDeleted } from '../../runtime/characters';
import { markDeleted, purgeNow } from '../../runtime/removal';
import { newOf } from '../common/acts';
import { downloadOutput, fileNamed } from '../common/download';
import { BIN_KEEPS, moduleName, promptName, TOOL } from '../common/words';
import { useFiles, useStore } from '../session';
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

export function useNewCharacter() {
  const store = useStore();
  const toast = useToast();
  return () => {
    const id = crypto.randomUUID();
    void createCharacter(store, newOf('캐릭터'), id).then((saved) => saved.ok || toast.failed(saved, '캐릭터를 만들지 못했어요.'));
    navigate({ kind: 'edit', character: id });
  };
}

export function useCharacterActions() {
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const [busy, setBusy] = useState<{ id: string; label: string } | null>(null);
  // The character whose 링크로 공유 dialog is open (ShareDialog, which the screen holding these actions draws).
  const [sharing, setSharing] = useState<Shelf | null>(null);

  async function copy({ id, character }: Shelf) {
    setBusy({ id, label: '사본 만드는 중' });
    const copied = await copyCharacter(store, id, `${character.card.name} (사본)`, (step) => setBusy({ id, label: describeStep(step) }));
    setBusy(null);
    if (!copied.ok) return toast.failed(copied, '사본을 만들지 못했어요.');
    toast.show('사본을 만들었어요.');
    navigate({ kind: 'edit', character: copied.data });
  }

  // The save picker opens before any await, inside the press that asked for it.
  function exportFile({ id, character }: Shelf) {
    const destination = downloadOutput(fileNamed(character.card.name, '캐릭터', 'charx'));
    setBusy({ id, label: '내보내는 중' });
    void (async () => {
      try {
        const made = await exportCharacter(store, files, id, await destination, ({ done, total }) => setBusy({ id, label: `내보내는 중 · ${done} / ${total}` }));
        if (made.ok) toast.show(`'${character.card.name}' 캐릭터를 내보냈어요.`, made.data.tools ? { detail: `${TOOL}가 든 모듈 ${made.data.tools}개는 빼고 내보냈어요.` } : undefined);
        else if (made.error === 'export-write') toast.error('파일을 저장하지 못했어요.', { detail: '저장 공간을 확인한 뒤 다시 시도해 주세요.' });
        else if (made.error === 'unreadable') toast.error('내보내지 못했어요.', { detail: '열리지 않는 이미지가 있어요.' });
        else toast.failed(made, '내보내지 못했어요.');
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) toast.error('파일을 저장하지 못했어요.');
      } finally {
        setBusy(null);
      }
    })();
  }

  function remove(shelf: Shelf) {
    const { id, character } = shelf;
    void setDeleted(store, id, Date.now()).then((saved) => saved.ok || toast.failed(saved));
    toast.undoable(`'${character.card.name}' ${withChats(shelf)} 삭제했어요.`, () => setDeleted(store, id, null), BIN_KEEPS);
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

  return { busy, copy, exportFile, remove, restore, purge, sharing, share: setSharing, stopSharing: () => setSharing(null) };
}
