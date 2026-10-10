import { FileText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Stored } from '../../model/kinds';
import { chatPrompt, ofSort } from '../../runtime/prompts';
import { matches, noResults, SEARCH_FROM } from '../common/search';
import { follows } from '../common/words';
import { useChats, useSession, useSettings, usePrompts } from '../session';
import { useToast } from '../toast';
import { Button, ChipButton, Dialog, Empty, hasFinePointer, Icon, List, ListItem, Row, SearchField } from '../ui';
import type { OpenChat } from './useChat';

// Without its own choice it follows the default live, and a deleted one shows as missing, never as another prompt.
export function ChatPromptPicker({ chat }: { chat: OpenChat }) {
  const { prompt, dialog, actions } = chat;
  const label = prompt.kind === 'prompt' ? prompt.prompt.value.name : prompt.own ? '삭제된 프롬프트' : '기본 프롬프트 없음';
  return (
    <ChipButton
      label={label}
      title="이 채팅의 프롬프트"
      leading={<Icon icon={FileText} size="xs" />}
      tone={prompt.kind === 'missing' ? 'warn' : 'default'}
      phone="icon"
      popup="dialog"
      expanded={dialog === 'prompt'}
      ref={null}
      onClick={() => actions.openDialog('prompt')}
    />
  );
}

// Mounted only while open, so each opening starts with an empty search. A touch screen gets no focused search, whose
// keyboard would cover the list.
export function PromptDialog({ chat }: { chat: OpenChat }) {
  const { prompt, actions } = chat;
  const { store } = useSession();
  const prompts = usePrompts().filter((each) => ofSort(each, 'conversation'));
  const chats = useChats();
  const settings = useSettings();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (hasFinePointer()) search.current?.focus();
  }, []);
  const fallback = settings.prompt === undefined ? null : (prompts.find(({ id }) => id === settings.prompt) ?? null);

  const used = new Map<string, number>();
  chats.forEach((item, index) => {
    const choice = chatPrompt(store, item.chat);
    if (choice.kind === 'prompt' && !used.has(choice.prompt.id)) used.set(choice.prompt.id, index);
  });
  const order = (a: Stored<'prompt'>, b: Stored<'prompt'>) => (used.get(a.id) ?? Infinity) - (used.get(b.id) ?? Infinity) || a.value.name.localeCompare(b.value.name, 'ko');
  const own = prompt.own && prompt.kind === 'prompt' ? prompt.prompt.id : null;
  const words = query.trim();
  const found = prompts.filter((item) => matches(words, item.value.name)).sort(order);

  function choose(value: string | null) {
    actions.closeDialog();
    void actions.setOwn('prompt', value).then((saved) => saved.ok || toast.failed(saved));
  }
  function open(id: string | null) {
    actions.closeDialog();
    actions.side({ kind: 'prompts', id, pane: null });
  }

  const toolbar = prompts.length >= SEARCH_FROM && (
    <SearchField
      ref={search}
      size="sm"
      label="프롬프트 검색"
      value={query}
      onChange={setQuery}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || !found[0]) return;
        event.preventDefault();
        choose(found[0].id);
      }}
    />
  );
  const footer = (
    <Row kind="actions">
      {prompt.kind === 'prompt' && (
        <Button variant="link" onClick={() => open(prompt.prompt.id)}>
          이 프롬프트 편집
        </Button>
      )}
      <Button variant="link" onClick={() => open(null)}>
        프롬프트 관리
      </Button>
    </Row>
  );
  return (
    <Dialog title="이 채팅의 프롬프트" onClose={actions.closeDialog} toolbar={toolbar} footer={footer}>
      {words && found.length === 0 && <Empty>{noResults(words)}</Empty>}
      <List label="프롬프트">
        {!words && <ListItem title={follows('기본 프롬프트')} description={fallback?.value.name ?? '기본 프롬프트 없음'} selected={!prompt.own} onClick={() => choose(null)} />}
        {found.map((item) => (
          <ListItem key={item.id} title={item.value.name} badge={item.id === settings.prompt ? '기본' : undefined} selected={item.id === own} onClick={() => choose(item.id)} />
        ))}
      </List>
    </Dialog>
  );
}
