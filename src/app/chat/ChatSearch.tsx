import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { SHORTCUTS, titled } from '../shortcuts';
import { IconButton, pressed, SearchField } from '../ui';
import type { ChatActions, OpenChat } from './useChat';

export function ChatSearch({ search, actions }: { search: NonNullable<OpenChat['search']>; actions: ChatActions }) {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, [search.focus]);

  // Each key is taken here, so Esc closes the bar alone: not a menu (layers.ts), not 답장 멈추기, and not the
  // browser's own clearing of a search field.
  const keys = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = pressed(event, SHORTCUTS.findNext.keys) ? 1 : pressed(event, SHORTCUTS.findPrevious.keys) ? -1 : 0;
    if (step !== 0) {
      event.preventDefault();
      actions.stepSearch(step);
    } else if (pressed(event, SHORTCUTS.closeFind.keys)) {
      event.preventDefault();
      actions.closeSearch();
    }
  };
  const none = search.hits === 0;
  return (
    <SearchField
      ref={field}
      label={SHORTCUTS.find.label}
      size="sm"
      grow
      value={search.term}
      onChange={actions.searchFor}
      onKeyDown={keys}
      after={
        <>
          {search.term.trim() && <span aria-live="polite">{`${search.place ?? (none ? 0 : '–')} / ${search.hits}`}</span>}
          <IconButton icon={ChevronUp} size="xs" label={SHORTCUTS.findPrevious.label} title={titled(SHORTCUTS.findPrevious.label, SHORTCUTS.findPrevious.keys)} disabled={none} onClick={() => actions.stepSearch(-1)} />
          <IconButton icon={ChevronDown} size="xs" label={SHORTCUTS.findNext.label} title={titled(SHORTCUTS.findNext.label, SHORTCUTS.findNext.keys)} disabled={none} onClick={() => actions.stepSearch(1)} />
          <IconButton icon={X} size="xs" label={SHORTCUTS.closeFind.label} title={titled(SHORTCUTS.closeFind.label, SHORTCUTS.closeFind.keys)} onClick={actions.closeSearch} />
        </>
      }
    />
  );
}
