import type { ReactNode } from 'react';
import type { SideAt } from '../chat/ChatScreen';
import { CharacterEditor } from '../library/CharacterEditor';
import { PersonaEditor } from '../personas/PersonaEditor';
import { PersonaList } from '../personas/PersonaList';
import { PromptEditor } from '../prompts/PromptEditor';
import { PromptList } from '../prompts/PromptList';
import { useCharacter, usePersonas, usePrompts } from '../session';
import { NavBar, SidePanel, type NavBarProps } from '../ui';

// Ctrl+E and Ctrl+P beside the chat: the list first, and the one picked opens in its place. 캐릭터 편집 opens the
// chat's character alone. Each editor is keyed by its id and saves as it unmounts, so going back to the list or
// closing the panel saves what was typed.
export function ChatSide({ open, inUse, onOpen, onClose }: SideAt) {
  const personas = usePersonas();
  const prompts = usePrompts();
  const shelf = useCharacter(open.kind === 'character' ? open.id : null);
  const panel =
    (title: string) =>
    ({ head, body, open: page }: { head: NavBarProps; body: ReactNode; open?: string }) => (
      <SidePanel title={title} top={<NavBar {...head} />} page={page} onClose={onClose}>
        {body}
      </SidePanel>
    );

  if (open.kind === 'character') {
    // The chat is gone from the page with its character, so the character is there while this is.
    const { character } = shelf!;
    return <CharacterEditor key={open.id} id={open.id} initial={character} frame={panel('캐릭터')} />;
  }
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
