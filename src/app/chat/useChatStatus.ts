import { useState } from 'react';
import type { Display } from '../../engine/display';
import type { Character } from '../../model/library';
import { setKeepStatus, setStatusScript } from '../../runtime/characters';
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
  // Where the status window stands: in its latest message, or with 옆에 두기 in the story's margin, while each box
  // fits there (fitting, which the margin reports whether it is shown or not). The key hides it there for now.
  const [fitting, setFitting] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  const fits = status.length > 0 && status.every(({ id, drawn }) => drawn === null || fitting.get(id) === true);
  const beside = bot && settings?.keepStatus === true && fits;
  const [hidden, setHidden] = useState(false);
  const hosted = (index: number) => beside ? [] : status.flatMap(({ id, drawn }) => (drawn?.message === index ? [{ ...drawn, id }] : []));
  const { seen, watch } = useSeen();
  // 상태 shown over the story by a key or a tap, rather than by pointing at its tab.
  const [held, hold] = useState(false);
  const peeking = status.length > 0 && !(beside && !hidden) && (held || status.some(({ id }) => !seen.has(id)));

  function markStatus({ id, name }: { id: string; name: string }, on: boolean) {
    if (!character) return;
    void setStatusScript(store, character, id, on).then((saved) => saved.ok || toast.failed(saved));
    if (!on && statusScripts.length === 1) hold(false);
    toast.undoable(on ? '상태창으로 지정했어요' : '상태창 지정을 풀었어요', () => void setStatusScript(store, character, id, !on), [name, card?.name].filter(Boolean).join(' · '));
  }

  // 옆에 두기, or on false 탭으로 접기, for every chat of the character.
  function keepStatus(keep: boolean) {
    if (!character) return;
    hold(false);
    setHidden(false);
    void setKeepStatus(store, character, keep).then((saved) => saved.ok || toast.failed(saved));
  }

  // The key shows or hides 상태 for now, storing nothing: in the margin while it stands there, or else the drawer
  // over the story.
  function toggleStatus() {
    hold(!beside && !held);
    if (beside) setHidden(!hidden);
  }

  return {
    status,
    hosted,
    offered,
    held,
    peeking,
    aside: beside && !hidden,
    canKeep: fits,
    actions: {
      hold,
      keepStatus: () => keepStatus(true),
      foldStatus: () => keepStatus(false),
      toggleStatus,
      fitStatus: (script: string, fits: boolean) => setFitting((current) => (current.get(script) === fits ? current : new Map(current).set(script, fits))),
      markStatus,
      watch,
    },
  };
}
