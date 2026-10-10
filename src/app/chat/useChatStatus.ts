import { useState } from 'react';
import type { Display } from '../../engine/display';
import type { Character } from '../../model/library';
import { setStatusScript } from '../../runtime/characters';
import { statusBoxes, statusPlaces } from '../../runtime/chat-context';
import type { Shown } from '../../runtime/talk';
import { useSession } from '../session';
import { scriptName } from '../common/words';
import { useToast } from '../toast';
import { useSeen } from './useSeen';

export function useChatStatus(character: string | null, settings: Character | null, view: Display, messages: Shown[]) {
  const { store } = useSession();
  const toast = useToast();
  const card = settings?.card ?? null;
  const bot = settings?.decor !== false;
  // 상태창 지정 (design §6.4).
  const statusScripts = bot && card ? statusPlaces(card, settings?.statusScripts ?? []) : [];
  const nameAt = (place: number) => scriptName(card?.regex[place]?.name ?? '', 'regex', place);
  const status = statusBoxes(view, messages, statusScripts).map((box) => ({ ...box, name: nameAt(box.place) }));
  // Only the card's own scripts, which come first among the packs': a module's place moves as modules go on and off.
  const own = card?.regex ?? [];
  const offered = (index: number) =>
    bot ? view.drawn[index]!.flatMap((place) => (place < own.length ? [{ id: own[place]!.id, name: nameAt(place), marked: statusScripts.some(({ place: marked }) => marked === place) }] : [])) : [];
  const hosted = (index: number) => status.flatMap(({ id, drawn }) => (drawn?.message === index ? [{ ...drawn, id }] : []));
  const { seen, watch } = useSeen();
  // 상태 shown over the story by a key or a tap, rather than by pointing at its tab.
  const [held, hold] = useState(false);
  const peeking = status.length > 0 && (held || status.some(({ id }) => !seen.has(id)));

  function markStatus({ id, name }: { id: string; name: string }, on: boolean) {
    if (!character) return;
    void setStatusScript(store, character, id, on).then((saved) => saved.ok || toast.failed(saved));
    if (!on && statusScripts.length === 1) hold(false);
    toast.undoable(on ? '상태창으로 지정했어요' : '상태창 지정을 풀었어요', () => setStatusScript(store, character, id, !on), [name, card?.name].filter(Boolean).join(' · '));
  }

  return {
    status,
    hosted,
    offered,
    held,
    peeking,
    actions: {
      hold,
      // The key shows or hides the drawer for now, storing nothing.
      toggleStatus: () => hold(!held),
      markStatus,
      watch,
    },
  };
}
