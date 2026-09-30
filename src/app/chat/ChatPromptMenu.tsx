import { FileText } from 'lucide-react';
import type { Stored } from '../../model/kinds';
import { chatPrompt, ofSort } from '../../runtime/prompts';
import { follows } from '../common/words';
import { useChats, useSession, useSettings, usePrompts } from '../session';
import { useToast } from '../toast';
import { ChipButton, Divider, Icon, Menu, MenuHeading, MenuItem, Tag } from '../ui';
import type { OpenChat } from './useChat';

// Without its own choice it follows the default live, and a deleted one shows as missing, never as another prompt.
export function ChatPromptMenu({ chat }: { chat: OpenChat }) {
  const { prompt, promptMenu } = chat;
  const label = prompt.kind === 'prompt' ? prompt.prompt.value.name : prompt.own ? '프롬프트가 지워졌어요' : '기본 프롬프트가 없어요';
  return (
    <Menu
      handle={promptMenu}
      place="below-end"
      label="이 채팅의 프롬프트"
      trigger={(opener) => (
        <ChipButton label={label} title="이 채팅의 프롬프트" leading={<Icon icon={FileText} size="xs" />} tone={prompt.kind === 'missing' ? 'warn' : 'default'} phone="icon" {...opener} />
      )}
    >
      <PromptChoices chat={chat} />
      <Divider variant="menu" />
      <MenuItem label="프롬프트 관리…" onClick={() => chat.actions.side({ kind: 'prompts', id: null, pane: null })} />
      {prompt.kind === 'prompt' && <MenuItem label="이 프롬프트 편집…" onClick={() => chat.actions.side({ kind: 'prompts', id: prompt.prompt.id, pane: null })} />}
    </Menu>
  );
}

// Mounted only while the menu is open. The conversation prompts go by their latest use in any chat, then by name.
function PromptChoices({ chat }: { chat: OpenChat }) {
  const { prompt, actions } = chat;
  const { store } = useSession();
  const prompts = usePrompts().filter((each) => ofSort(each, 'conversation'));
  const chats = useChats();
  const settings = useSettings();
  const toast = useToast();
  const choose = (value: string | null) => void actions.setOwn('prompt', value).then((saved) => saved.ok || toast.failed(saved));
  const fallback = settings.prompt === undefined ? null : (prompts.find(({ id }) => id === settings.prompt) ?? null);

  const used = new Map<string, number>();
  chats.forEach((item, index) => {
    const choice = chatPrompt(store, item.chat);
    if (choice.kind === 'prompt' && !used.has(choice.prompt.id)) used.set(choice.prompt.id, index);
  });
  const order = (a: Stored<'prompt'>, b: Stored<'prompt'>) => (used.get(a.id) ?? Infinity) - (used.get(b.id) ?? Infinity) || a.value.name.localeCompare(b.value.name, 'ko');
  const own = prompt.own && prompt.kind === 'prompt' ? prompt.prompt.id : null;

  return (
    <>
      <MenuHeading>이 채팅만 바뀌어요 · 최근 사용</MenuHeading>
      <MenuItem label={follows('기본 프롬프트')} sub={fallback?.value.name ?? '기본 프롬프트가 없어요'} checked={!prompt.own} onClick={() => choose(null)} />
      {[...prompts].sort(order).map((item) => (
        <MenuItem
          key={item.id}
          label={item.value.name}
          tag={item.id === settings.prompt ? <Tag tone="accent">기본</Tag> : undefined}
          checked={item.id === own}
          onClick={() => choose(item.id)}
        />
      ))}
    </>
  );
}
