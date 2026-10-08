import { ChevronDown, ChevronRight, Import, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Stored } from '../../model/kinds';
import type { PromptSort } from '../../model/prompt';
import { addPrompt, isDefaultPrompt, ofSort } from '../../runtime/prompts';
import type { Frame } from '../common/frame';
import { TASK_NAMES } from '../common/prompt-words';
import { noResults } from '../common/search';
import { ago } from '../common/time';
import { usePrompts, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { PAGES, promptName } from '../common/words';
import { Button, ChoiceGroup, Empty, FileButton, Hint, List, ListItem, Row, SearchField, Stack, Tab, Tabs } from '../ui';
import { usePresetImport } from './PresetImport';
import { EMPTY_USE, usePromptUse, type PromptUse } from './usePromptUse';
import { byPromptName, groupPrompts } from './copies';

const NEW_NAME = { conversation: '새 프롬프트', translate: '새 번역 프롬프트', memory: '새 기억 프롬프트', illustrate: '새 삽화 프롬프트' } satisfies Record<PromptSort, string>;
const SORTS: { sort: PromptSort; label: string; hint?: string; none: string }[] = [
  { sort: 'conversation', label: '대화', none: '대화 프롬프트가 없어요. 새로 만들거나 Risu 프리셋을 가져와 보세요.' },
  { sort: 'translate', label: '번역', hint: '응답과 보낼 메시지를 번역할 때 쓰는 프롬프트예요.', none: '번역 프롬프트가 없어요. 새로 만들어 보세요.' },
  { sort: 'memory', label: '기억', hint: '지난 메시지를 장기 기억으로 정리할 때 쓰는 프롬프트예요.', none: '기억 프롬프트가 없어요. 새로 만들어 보세요.' },
  { sort: 'illustrate', label: '삽화', hint: '메시지에 넣을 이미지의 장면을 정할 때 쓰는 프롬프트예요.', none: '삽화 프롬프트가 없어요. 새로 만들어 보세요.' },
];
type Order = 'name' | 'recent';

const useWords = (use: PromptUse) => (use.chats ? `채팅 ${use.chats}개` : '쓰는 채팅 없음');
const used = (use: PromptUse) => (use.at === null ? useWords(use) : `${useWords(use)} · ${ago(use.at)} 씀`);

type Props = {
  onPick: (id: string) => void;
  inUse?: string;
  frame: Frame;
};

export function PromptList({ onPick, inUse, frame }: Props) {
  const store = useStore();
  const toast = useToast();
  const prompts = usePrompts();
  const grouped = useMemo(() => groupPrompts(prompts), [prompts]);
  const settings = useSettings();
  const uses = usePromptUse();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState<PromptSort>('conversation');
  const [order, setOrder] = useState<Order>('name');
  const preset = usePresetImport(onPick);

  const use = (id: string) => uses.get(id) ?? EMPTY_USE;
  const badge = (prompt: Stored<'prompt'>) => (isDefaultPrompt(settings, prompt) ? '기본' : undefined);
  const tags = (id: string) => (id === inUse ? ['사용 중'] : []);
  // Only conversation prompts are used by chats; a translation prompt is chosen by a character's 번역. An unused one
  // says nothing, so the few in use stand out in a long list.
  const usage = (prompt: Stored<'prompt'>) => {
    const of = use(prompt.id);
    return ofSort(prompt, 'conversation') && (of.chats > 0 || of.at !== null) ? used(of) : undefined;
  };

  function add(sort: PromptSort) {
    const id = crypto.randomUUID();
    void addPrompt(store, NEW_NAME[sort], sort, id).then((added) => added.ok || toast.failed(added, '프롬프트를 만들지 못했어요.'));
    onPick(id);
  }

  const byName = (a: Stored<'prompt'>, b: Stored<'prompt'>) => Number(isDefaultPrompt(settings, b)) - Number(isDefaultPrompt(settings, a)) || byPromptName(a, b);
  const byRecent = (a: Stored<'prompt'>, b: Stored<'prompt'>) => (use(b.id).at ?? -1) - (use(a.id).at ?? -1) || byPromptName(a, b);
  const recentFirst = shown === 'conversation' && order === 'recent';
  const top = grouped.top.filter((prompt) => ofSort(prompt, shown)).sort(recentFirst ? byRecent : byName);
  const current = SORTS.find(({ sort }) => sort === shown)!;

  const row = (prompt: Stored<'prompt'>) => {
    const copies = grouped.copies.get(prompt.id) ?? [];
    const expanded = open.has(prompt.id);
    const flip = () => setOpen((current) => new Set(current.has(prompt.id) ? [...current].filter((id) => id !== prompt.id) : [...current, prompt.id]));
    return (
      <ListItem
        key={prompt.id}
        title={promptName(prompt.value.name)}
        badge={badge(prompt)}
        tags={tags(prompt.id)}
        aside={usage(prompt)}
        onClick={() => onPick(prompt.id)}
        control={
          copies.length > 0 && (
            <Button variant="ghost" size="sm" icon={expanded ? ChevronDown : ChevronRight} expanded={expanded} onClick={flip}>
              {`사본 ${copies.length}`}
            </Button>
          )
        }
      >
        {expanded && copies.map(row)}
      </ListItem>
    );
  };

  const words = query.trim().toLowerCase();
  const found = prompts.filter((prompt) => promptName(prompt.value.name).toLowerCase().includes(words)).sort(byPromptName);

  const actions = (
    <Row kind="actions">
      <FileButton accept=".risup,.risupreset" size="sm" icon={Import} onFile={(file) => preset.take([file])}>
        Risu 프리셋 가져오기
      </FileButton>
      <Button size="sm" icon={Plus} onClick={() => add(shown)}>
        {NEW_NAME[shown]}
      </Button>
    </Row>
  );
  const body = (
    <>
      <Stack gap="related">
        <SearchField label="프롬프트 검색" value={query} onChange={setQuery} />
      </Stack>
      {words ? (
        found.length ? (
          <List label="검색 결과">
            {found.map((prompt) => (
              <ListItem
                key={prompt.id}
                title={promptName(prompt.value.name)}
                badge={badge(prompt)}
                tags={[...(prompt.value.task ? [TASK_NAMES[prompt.value.task]] : []), ...tags(prompt.id)]}
                aside={usage(prompt)}
                onClick={() => onPick(prompt.id)}
              />
            ))}
          </List>
        ) : (
          <Empty>{noResults(query.trim())}</Empty>
        )
      ) : (
        <>
          <Row kind="spread">
            <Row kind="toolbar">
              <Tabs label="프롬프트 종류">
                {SORTS.map(({ sort, label }) => (
                  <Tab key={sort} label={label} count={prompts.filter((prompt) => ofSort(prompt, sort)).length} current={sort === shown} onClick={() => setShown(sort)} />
                ))}
              </Tabs>
              {current.hint && <Hint label={`${current.label} 프롬프트`}>{current.hint}</Hint>}
            </Row>
            {shown === 'conversation' && (
              <ChoiceGroup
                layout="segmented"
                label="정렬"
                options={[
                  { value: 'name', label: '이름' },
                  { value: 'recent', label: '최근 사용' },
                ]}
                value={order}
                onChange={setOrder}
              />
            )}
          </Row>
          {top.length ? <List label={`${current.label} 프롬프트`}>{top.map(row)}</List> : <Empty variant="section">{current.none}</Empty>}
        </>
      )}
      {preset.view}
    </>
  );
  return frame({ head: { title: PAGES.prompts, actions }, body });
}
