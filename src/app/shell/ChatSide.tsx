import type { ReactNode } from 'react';
import { live } from '../../model/library';
import type { SideAt } from '../chat/ChatScreen';
import { CharacterEditor } from '../library/CharacterEditor';
import { PromptEditor } from '../prompts/PromptEditor';
import { PromptList } from '../prompts/PromptList';
import { useCharacter, useStored } from '../session';
import { SidePanel, type NavBarProps } from '../ui';

type Props<K extends SideAt['open']['kind']> = Omit<SideAt, 'open'> & { open: Extract<SideAt['open'], { kind: K }> };
const panel =
  (title: string, onClose: () => void) =>
  ({ head, body, open: page }: { head: NavBarProps; body: ReactNode; open?: string }) => (
    <SidePanel title={title} nav={head} page={page} expandable onClose={onClose}>
      {body}
    </SidePanel>
  );

// Each editor is keyed by its id and saves as it unmounts, so going back to the list or closing the panel saves what
// was typed. A prompt opened at a block is keyed by the block too, so another block asked for opens there.
export function ChatSide(props: SideAt) {
  const { open } = props;
  if (open.kind === 'character') return <CharacterSide {...props} open={open} />;
  return <PromptSide {...props} open={open} />;
}

function CharacterSide({ open, onOpen, onClose }: Props<'character'>) {
  // The chat is gone from the page with its character, so the character is there while this is.
  const shelf = useCharacter(open.id)!;
  return <CharacterEditor key={open.id} shelf={shelf} layout="drill" part={open.part} onPart={(part) => onOpen({ ...open, part })} frame={panel('캐릭터', onClose)} />;
}

function PromptSide({ open, inUse, onOpen, onClose }: Props<'prompts'>) {
  const stored = live(useStored('prompt', open.id));
  const toList = () => onOpen({ kind: 'prompts', id: null, pane: null });
  if (!stored) return <PromptList onPick={(id) => onOpen({ kind: 'prompts', id, pane: null })} inUse={inUse ?? undefined} frame={panel('프롬프트', onClose)} />;
  return (
    <PromptEditor
      key={`${stored.id}:${open.block ?? ''}`}
      stored={stored}
      layout="drill"
      pane={open.pane}
      block={open.block}
      onPane={(pane) => onOpen({ ...open, pane })}
      backLabel="프롬프트 목록"
      onBack={toList}
      onCopied={(id) => onOpen({ kind: 'prompts', id, pane: null })}
      onErased={toList}
      frame={panel('프롬프트', onClose)}
    />
  );
}
