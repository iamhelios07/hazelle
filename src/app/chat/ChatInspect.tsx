import type { ComponentProps } from 'react';
import { SidePanel } from '../ui';
import { ChatCachePanel } from './ChatCachePanel';
import type { InspectTab } from './panels';
import type { SendNotes } from './useSendNotes';

export type ChatInspectProps = Omit<ComponentProps<typeof ChatCachePanel>, 'cache'> & { tab: InspectTab; notes: SendNotes };

export function ChatInspect({ tab, notes, ...props }: ChatInspectProps) {
  return tab === 'cache' ? <ChatCachePanel {...props} cache={notes.cache} /> : <SidePanel title="" onClose={props.onClose}>{null}</SidePanel>;
}
