import { useState } from 'react';
import type { ChatSummary } from '../../model/chat';
import type { CharacterShelf } from '../../model/library';
import type { CharacterPart } from '../common/characterPart';
import { framePage } from '../common/frame';
import { backBar } from '../shell/router';
import type { Back } from '../shell/routes';
import { useWide } from '../ui';
import { CharacterEditor } from './CharacterEditor';

export function CharacterEditScreen({ shelf, back }: { shelf: CharacterShelf<ChatSummary>; back: Back | null }) {
  const wide = useWide();
  const [part, setPart] = useState<CharacterPart | null>(null);
  // A part's own 뒤로, back to the list of parts, comes before the page's.
  return <CharacterEditor shelf={shelf} layout={wide ? 'split' : 'drill'} part={part} onPart={setPart} frame={(parts) => framePage({ ...parts, head: { ...backBar(back), ...parts.head } })} />;
}
