import { useSyncExternalStore } from 'react';
import { seesPictures } from '../../connectors/types';
import { SIGNATURE } from '../../engine/assets';
import type { Chat } from '../../model/chat';
import { without } from '../../model/fields';
import type { Route, RouteFailure } from '../../runtime/assignment';
import { seesPicturesNow } from '../../runtime/connections';
import { addDraftPicture } from '../../runtime/inlays';
import { NO_PICTURES, UNKNOWN_PICTURES } from '../common/words';
import { useChildren, useSession } from '../session';
import { useToast } from '../toast';

// sees: whether the chat's model takes pictures, null where neither its catalog nor the user says (asked again on the
// next attach).
// moved: the chat's 옮겨 온 그림도 보내기, null in a chat that holds no picture brought from Risu.
export function useChatPictures(id: string | null, key: string, chat: Chat, route: Route | RouteFailure) {
  const session = useSession();
  const { drafts, store } = session;
  const toast = useToast();
  const draft = useSyncExternalStore(drafts.subscribe, () => drafts.pictures(key));
  const brought = useChildren('inlay', id).some(({ value }) => !value.attached && value.type !== SIGNATURE);
  const sees = 'kind' in route ? false : route.model.input === null && !route.model.pictures ? null : seesPictures(route.model);

  async function attach(files: File[]) {
    if ('kind' in route || !(await seesPicturesNow(session, route))) return toast.show(sees === null ? UNKNOWN_PICTURES : NO_PICTURES);
    const added = await Promise.all(files.map((file) => addDraftPicture(session, key, file)));
    const refused = added.filter((ok) => !ok).length;
    if (refused) toast.show(`이미지가 아닌 파일 ${refused}개는 넣지 않았어요.`);
  }

  function sendMoved(on: boolean) {
    if (!id) return;
    void store.update('chat', id, (current) => (on ? { ...current, movedPictures: true as const } : without(current, 'movedPictures'))).then((saved) => saved.ok || toast.failed(saved));
  }

  return {
    attachments: { draft, sees, moved: brought ? chat.movedPictures === true : null },
    actions: { attachPictures: (files: File[]) => void attach(files), removePicture: (name: string) => drafts.removePicture(key, name), sendMoved },
  };
}
