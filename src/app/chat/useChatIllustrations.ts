import { useEffect, useMemo, useState } from 'react';
import { shown } from '../../model/chat';
import type { IllustrateSwitches, Scene } from '../../model/illustration';
import type { Stored } from '../../model/kinds';
import { illustrateSwitches, setIllustrate, setOwnIllustrate } from '../../runtime/characters';
import { removeIllustration, restoreIllustration, type Drawing } from '../../runtime/illustrate';
import type { Shown } from '../../runtime/talk';
import { describeIllustrateFailure } from '../common/failure';
import { useChildren, useIllustrating, useSession } from '../session';
import { useToast } from '../toast';

// The failures a toast already said, by run: each is said once, though the chat is left and opened again.
const told = new WeakSet<Drawing>();

// A version's pictures, oldest first.
function picturesByVersion(illustrations: Stored<'illustration'>[]): ReadonlyMap<string, Stored<'illustration'>[]> {
  const versions = new Map<string, Stored<'illustration'>[]>();
  for (const picture of [...illustrations].sort((a, b) => a.value.at - b.value.at)) {
    const pictures = versions.get(picture.value.version);
    if (pictures) pictures.push(picture);
    else versions.set(picture.value.version, [picture]);
  }
  return versions;
}

// 어떻게 바꿀까요?: the scene a picture or a failed run had, drawn again once changed. paragraphs: how many its version holds.
export type Reshaping = { message: string; version: string; scene: Scene; paragraphs: number };
export type IllustrationActions = ReturnType<typeof useChatIllustrations>['actions'];

export function useChatIllustrations(chatId: string, id: string | null, character: string | null) {
  const { store, illustrator } = useSession();
  const toast = useToast();
  const illustrate = illustrateSwitches(store, character);
  const illustrations = useChildren('illustration', id);
  const pictures = useMemo(() => picturesByVersion(illustrations), [illustrations]);
  const illustrating = useIllustrating();
  // Settled by the switch and the pictures, not by a picture landing, so the story moves aside before one does.
  const stage = illustrate.auto || illustrations.length > 0 || [...illustrating.values()].some((drawing) => drawing.chat === chatId);
  const [reshaping, setReshaping] = useState<Reshaping | null>(null);

  useEffect(() => {
    for (const drawing of illustrating.values()) {
      if (drawing.chat !== chatId || drawing.stage !== 'failed' || told.has(drawing)) continue;
      told.add(drawing);
      toast.error(describeIllustrateFailure(drawing.failure));
    }
  }, [illustrating]);

  function setIllustrateSwitches(change: Partial<IllustrateSwitches>) {
    void setIllustrate(store, character, change).then((saved) => saved.ok || toast.failed(saved));
  }

  function setOwnIllustrateSwitches(own: boolean) {
    void setOwnIllustrate(store, character!, own).then((saved) => saved.ok || toast.failed(saved));
  }

  // scene: one already written, drawn again with no scene call. spend: the user's 그래도 만들기 on a picture that may cost.
  function draw(message: string, version: string, scene: Scene | null = null, spend = false) {
    if (id) illustrator.draw(id, message, version, { scene, spend });
  }

  function dropPicture(picture: Stored<'illustration'>) {
    void removeIllustration(store, picture.id).then((removed) => removed.ok || toast.failed(removed));
    toast.undoable('삽화를 삭제했어요.', () => restoreIllustration(store, picture));
  }

  return {
    illustrate, pictures, illustrating, stage, reshaping,
    actions: {
      setIllustrate: setIllustrateSwitches,
      setOwnIllustrate: setOwnIllustrateSwitches,
      illustrate: (message: Shown) => draw(message.id, shown(message).id),
      draw,
      dismissIllustration: (message: string) => illustrator.dismiss(message),
      dropPicture,
      reshape: setReshaping,
    },
  };
}
