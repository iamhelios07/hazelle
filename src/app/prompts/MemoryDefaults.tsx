import type { Chat } from '../../model/chat';
import type { MemorySettings } from '../../model/memory';
import { memorySetup, setDefaultMemory } from '../../runtime/memory';
import { MemoryFields, settingsOf } from '../common/MemoryFields';
import { useAutosave } from '../common/useAutosave';
import { useSettings, useStore } from '../session';
import { Section } from '../ui';

// A chat with nothing of its own, which memorySetup reads as the account's default.
const NO_CHAT: Chat = { title: null, character: null, models: {} };

// The account's memory settings, which every chat without its own follows.
export function MemoryDefaults() {
  const store = useStore();
  // Subscribed for its changes: memorySetup reads the settings from the store.
  useSettings();
  const save = useAutosave<MemorySettings>((patch) => setDefaultMemory(store, patch));
  return (
    <Section title="장기 기억" hint="채팅마다 장기 기억 패널에서 따로 정할 수 있어요.">
      <MemoryFields value={{ ...settingsOf(memorySetup(store, NO_CHAT)), ...save.unsaved }} onChange={save.change} />
    </Section>
  );
}
