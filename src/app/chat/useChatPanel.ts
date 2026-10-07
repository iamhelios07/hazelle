import { useState } from 'react';
import { usePersisted } from '../common/usePersisted';
import { usePanelCovers } from '../ui';
import type { Side } from './useChat';

const TOGGLES_STAND = 'risu-alpha:toggles-stand';

type Visitor = { kind: 'memory'; record: string | null } | { kind: 'info' } | Side;

// 토글 stands beside the story where the page is wide enough, open from the first visit and remembered per device;
// 장기 기억, 응답 정보 and the prompt and character screens take its place for a while, and closing one shows it again.
// Where the panel covers the story, 토글 opens only when asked, and another panel's opening puts it away.
export function useChatPanel() {
  const covers = usePanelCovers();
  const [stands, setStands] = usePersisted(TOGGLES_STAND, (stored) => stored === '1', true, (on) => (on ? '1' : '0'));
  const [asked, setAsked] = useState(false);
  const [visitor, setVisitor] = useState<Visitor | null>(null);
  const toggles = covers ? asked : stands;
  const showToggles = covers ? setAsked : setStands;
  const panel: { kind: 'toggles' } | Visitor | null = visitor ?? (toggles ? { kind: 'toggles' } : null);
  return {
    panel,
    visit: (next: Visitor) => {
      setVisitor(next);
      setAsked(false);
    },
    flipToggles: () => {
      if (panel?.kind === 'toggles') return showToggles(false);
      setVisitor(null);
      showToggles(true);
    },
    closePanel: () => (visitor ? setVisitor(null) : showToggles(false)),
  };
}
