import { useState, type DragEvent } from 'react';

// A card carries its key under a type of its own: the app-wide file drop (overlays/useFileDrop) takes only drags that
// carry Files, which is why a dragged card's picture must not drag itself.
const CARD = 'application/x-hazelle-card';

export const cardDrag = (key: string) => ({
  draggable: true,
  onDragStart: (event: DragEvent) => {
    event.dataTransfer.setData(CARD, key);
    event.dataTransfer.effectAllowed = 'move';
  },
});

// over: a card is held above the target.
export function useCardDrop(onDrop: ((key: string) => void) | undefined) {
  const [over, setOver] = useState(false);
  if (!onDrop) return { over: false, props: {} };
  const carries = (event: DragEvent) => event.dataTransfer.types.includes(CARD);
  return {
    over,
    props: {
      onDragOver: (event: DragEvent) => {
        if (!carries(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        setOver(true);
      },
      onDragLeave: (event: DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (event: DragEvent) => {
        if (!carries(event)) return;
        event.preventDefault();
        setOver(false);
        onDrop(event.dataTransfer.getData(CARD));
      },
    },
  };
}
