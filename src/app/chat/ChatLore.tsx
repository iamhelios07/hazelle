import { LoreEditor } from '../common/LoreEditor';
import { CHAT_LORE } from '../common/words';
import { useStored } from '../session';
import { SidePanel } from '../ui';

export function ChatLore({ id, onClose }: { id: string; onClose: () => void }) {
  const stored = useStored('chat', id);
  return (
    <SidePanel title={CHAT_LORE} onClose={onClose}>
      <LoreEditor owner={{ kind: 'chat', id }} folders={stored?.value.loreFolders ?? []} />
    </SidePanel>
  );
}
