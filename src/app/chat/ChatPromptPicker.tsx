import { FileText } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import type { Stored } from '../../model/kinds';
import { chatPrompt, isDefaultPrompt, ofSort } from '../../runtime/prompts';
import { useSearch } from '../common/useSearch';
import { byLastUse, byPromptName, groupPrompts } from '../common/promptCopies';
import { EMPTY_USE, promptUseWords, usePromptUse } from '../common/usePromptUse';
import { defaultMark, DELETED_PROMPT, follows, promptName } from '../common/words';
import { useSession, useSettings, usePrompts } from '../session';
import { useToast } from '../toast';
import { Button, ChipButton, Dialog, Empty, hasFinePointer, Icon, List, ListItem, Row } from '../ui';
import type { OpenChat } from './useChat';

// Without its own choice it follows the default live, and a deleted one shows as missing, never as another prompt.
export function ChatPromptPicker({ chat }: { chat: OpenChat }) {
  const { prompt, dialog, actions } = chat;
  const label = prompt.kind === 'prompt' ? prompt.prompt.value.name : prompt.own ? DELETED_PROMPT : '기본 프롬프트 없음';
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
  const uses = usePromptUse();
  const settings = useSettings();
  const toast = useToast();
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (hasFinePointer()) field.current?.focus();
  }, []);
  const fallback = chatPrompt(store, {});
  const grouped = groupPrompts(prompts);
  const own = prompt.own && prompt.kind === 'prompt' ? prompt.prompt.id : null;
  const search = useSearch(prompts.toSorted(byPromptName), '프롬프트 검색', (item) => [promptName(item.value.name)], { ref: field, onEnter: (first) => choose(first.id) });

  function choose(value: string | null) {
    actions.closeDialog();
    void actions.setOwn('prompt', value).then((saved) => saved.ok || toast.failed(saved));
  }
  function open(id: string | null) {
    actions.closeDialog();
    actions.side({ kind: 'prompts', id, pane: null });
  }

  // A picker shows every copy under its original, since the one to pick is often a copy.
  const row = (item: Stored<'prompt'>, nested: boolean): ReactNode => (
    <ListItem
      key={item.id}
      title={promptName(item.value.name)}
      badge={defaultMark(isDefaultPrompt(settings, item), item.value.name)}
      aside={promptUseWords(uses.get(item.id) ?? EMPTY_USE)}
      selected={item.id === own}
      onClick={() => choose(item.id)}
    >
      {nested && grouped.copies.get(item.id)?.map((copy) => row(copy, true))}
    </ListItem>
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
    <Dialog title="이 채팅의 프롬프트" onClose={actions.closeDialog} toolbar={search.field || undefined} footer={footer}>
      {search.none && <Empty>{search.none}</Empty>}
      <List label="프롬프트">
        {!search.words && <ListItem title={follows('기본 프롬프트')} description={fallback.kind === 'prompt' ? fallback.prompt.value.name : '기본 프롬프트 없음'} selected={!prompt.own} onClick={() => choose(null)} />}
        {search.words ? search.found.map((item) => row(item, false)) : grouped.top.toSorted(byLastUse(uses, grouped.copies)).map((item) => row(item, true))}
      </List>
    </Dialog>
  );
}
