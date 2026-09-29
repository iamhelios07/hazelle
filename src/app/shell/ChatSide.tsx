import type { ReactNode } from 'react';
import type { SideAt } from '../chat/ChatScreen';
import { PersonaEditor } from '../personas/PersonaEditor';
import { PersonaList } from '../personas/PersonaList';
import { PromptEditor } from '../prompts/PromptEditor';
import { PromptList } from '../prompts/PromptList';
import { useViews } from '../session';
import { NavBar, SidePanel, type NavBarProps } from '../ui';

// design F3: Ctrl+E and Ctrl+P beside the chat. The list comes first ("목록부터", user, 2026-09-29), and the one
// picked opens in its place with a way back to it. Each editor is keyed by its id and saves as it unmounts, so going
// back to the list or closing the panel saves what was typed.
export function ChatSide({ open, inUse, onOpen, onClose }: SideAt) {
  const { personas, prompts } = useViews();
  const panel =
    (title: string) =>
    ({ head, body, open: page }: { head: NavBarProps; body: ReactNode; open?: string }) => (
      <SidePanel title={title} top={<NavBar {...head} />} page={page} onClose={onClose}>
        {body}
      </SidePanel>
    );

  if (open.kind === 'personas') {
    const toList = () => onOpen({ kind: 'personas', id: null });
    const stored = personas.find((persona) => persona.id === open.id);
    if (!stored) return <PersonaList onPick={(id) => onOpen({ kind: 'personas', id })} inUse={inUse ?? undefined} frame={panel('페르소나')} />;
    return <PersonaEditor key={stored.id} stored={stored} backLabel="페르소나 목록" onBack={toList} onRemoved={toList} frame={panel('페르소나')} />;
  }
  const toList = () => onOpen({ kind: 'prompts', id: null, pane: null });
  const stored = prompts.find((prompt) => prompt.id === open.id);
  if (!stored) return <PromptList onPick={(id) => onOpen({ kind: 'prompts', id, pane: null })} inUse={inUse ?? undefined} frame={panel('프롬프트')} />;
  return (
    <PromptEditor
      key={stored.id}
      stored={stored}
      layout="drill"
      pane={open.pane}
      onPane={(pane) => onOpen({ ...open, pane })}
      backLabel="프롬프트 목록"
      onBack={toList}
      onCopied={(id) => onOpen({ kind: 'prompts', id, pane: null })}
      onErased={toList}
      frame={panel('프롬프트')}
    />
  );
}
