import { ImageIcon } from 'lucide-react';
import { IllustrateRows } from '../common/IllustrateRows';
import { PerCharacter } from '../common/TaskPrompt';
import { scopeTag } from '../common/words';
import { Menu, Section, Stack, ToolButton } from '../ui';
import type { IllustrateSetup } from '../../runtime/characters';
import type { PromptDoor } from '../common/TaskPrompt';
import type { sceneWriterOf } from '../../runtime/illustrate';
import type { IllustrationActions } from './useChatIllustrations';

type Props = {
  illustrate: IllustrateSetup;
  sceneWriter: ReturnType<typeof sceneWriterOf>;
  card: { name: string } | null;
  onChange: IllustrationActions['setIllustrate'];
  onOwnChange: IllustrationActions['setOwnIllustrate'];
  onEditPrompt: (door: PromptDoor) => void;
};

export function ChatIllustrate({ illustrate, sceneWriter, card, onChange, onOwnChange, onEditPrompt }: Props) {
  return (
    <Menu
      kind="dialog"
      size="form"
      place="above-start"
      label="삽화"
      trigger={(opener) => <ToolButton icon={ImageIcon} label="삽화" phone="icon" detail={illustrate.auto ? '자동 삽화 켜짐' : undefined} mark={illustrate.auto ? { kind: 'dot' } : undefined} {...opener} />}
    >
      <Section level={3} title="삽화" tag={scopeTag(card && illustrate.own ? 'character' : 'default')}>
        <Stack gap="related">
          <IllustrateRows illustrate={illustrate} sceneWriter={sceneWriter} card={card} opens="up" onChange={onChange} onEditPrompt={onEditPrompt} />
          <PerCharacter card={card} own={illustrate.own} onChange={onOwnChange} />
        </Stack>
      </Section>
    </Menu>
  );
}
