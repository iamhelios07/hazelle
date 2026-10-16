import type { ReactNode } from 'react';
import type { From } from '../../engine/pipeline';
import type { Sending } from '../../runtime/turn-context';
import { useSession } from '../session';
import { Empty, SidePanel, Stack, Tab, Tabs, Text } from '../ui';
import { CacheTab } from './ChatCacheTab';
import { Modules } from './InspectModules';
import { NextRequest } from './InspectRequest';
import { Scripts } from './InspectScripts';
import { Variables } from './InspectVariables';
import { editorOf, type InspectTab, type Side } from './panels';
import type { OpenChat } from './useChat';
import type { SendNotes } from './useSendNotes';

const TABS: { value: InspectTab; label: string }[] = [
  { value: 'request', label: '요청' },
  { value: 'cache', label: '캐시' },
  { value: 'variables', label: '변수' },
  { value: 'modules', label: '모듈' },
  { value: 'scripts', label: '스크립트' },
];

type ChatInspectProps = Pick<OpenChat, 'messages' | 'busy' | 'prompt'> & { chat: string; character: string | null; tab: InspectTab; notes: SendNotes; onTab: (tab: InspectTab) => void; onClose: () => void; onEdit: (side: Side) => void };

// 점검: every tab before a send reads the composer's one next-send result (useSendNotes), never a prompt of its own.
export function ChatInspect({ chat, character, tab, notes, messages, busy, prompt, onTab, onClose, onEdit }: ChatInspectProps) {
  const { store } = useSession();
  const conversation = prompt.kind === 'prompt' ? { id: prompt.prompt.id, blocks: prompt.prompt.value.blocks } : null;
  const editor = (from: From) => editorOf(from, conversation, character, (lore) => store.get('lore', lore)?.parent ?? null);
  const tabs = (
    <Tabs label="점검">
      {TABS.map((each) => (
        <Tab key={each.value} label={each.label} current={tab === each.value} onClick={() => onTab(each.value)} />
      ))}
    </Tabs>
  );
  const ready = (view: (sending: Sending) => ReactNode) =>
    busy ? <Empty variant="section">응답이 끝나면 다시 계산해요.</Empty>
    : notes.sending ? view(notes.sending)
    : notes.sending === null ? <Empty variant="section">지금은 요청을 보낼 수 없어서 계산하지 못했어요.</Empty>
    : <Text variant="note">계산하는 중…</Text>;
  return (
    <SidePanel title="점검" onClose={onClose}>
      <Stack gap="section">
        {tabs}
        {tab === 'request' && ready((sending) => <NextRequest chat={chat} sending={sending} request={notes.request} editor={editor} onEdit={onEdit} />)}
        {tab === 'cache' && <CacheTab cache={notes.cache} messages={messages} busy={busy} editor={editor} onEdit={onEdit} />}
        {tab === 'variables' && <Variables chat={chat} sending={notes.sending} busy={busy} />}
        {tab === 'modules' && ready((sending) => <Modules sending={sending} />)}
        {tab === 'scripts' && <Scripts chat={chat} />}
      </Stack>
    </SidePanel>
  );
}
