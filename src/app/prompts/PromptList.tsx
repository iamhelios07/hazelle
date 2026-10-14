import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Stored } from '../../model/kinds';
import type { PromptSort } from '../../model/prompt';
import { addPrompt, isDefaultPrompt, ofSort } from '../../runtime/prompts';
import { ACTS } from '../common/acts';
import type { Frame } from '../common/frame';
import { TASK_NAMES } from '../common/prompt-words';
import { useSearch } from '../common/useSearch';
import { useConnections, usePrompts, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { defaultMark, PAGES, promptName } from '../common/words';
import { Button, CardItem, CardList, ChoiceGroup, Columns, Empty, FileButton, Hint, PickCard, Row, Section, Tab, Tabs } from '../ui';
import { taskModelWords } from './ModelPane';
import { usePresetImport } from './PresetImport';
import { EMPTY_USE, promptUseWords, usePromptUse } from '../common/usePromptUse';
import { byLastUse, byPromptName, groupPrompts } from '../common/promptCopies';

const NEW_NAME = { conversation: '새 프롬프트', translate: '새 번역 프롬프트', memory: '새 기억 프롬프트', illustrate: '새 삽화 프롬프트' } satisfies Record<PromptSort, string>;
const SORTS: { sort: PromptSort; label: string; hint?: string; none: string }[] = [
  { sort: 'conversation', label: '대화', none: '대화 프롬프트가 없어요.' },
  { sort: 'translate', label: '번역', hint: '응답과 보낼 메시지를 번역할 때 쓰는 프롬프트예요.', none: '번역 프롬프트가 없어요.' },
  { sort: 'memory', label: '기억', hint: '지난 메시지를 장기 기억으로 정리할 때 쓰는 프롬프트예요.', none: '기억 프롬프트가 없어요.' },
  { sort: 'illustrate', label: '삽화', hint: '메시지에 넣을 이미지의 장면을 정할 때 쓰는 프롬프트예요.', none: '삽화 프롬프트가 없어요.' },
];
type Order = 'name' | 'recent';

// defaults: each kind's default leads the list, as a card that opens it. The default is chosen on the prompt's own
// page (기본으로 정하기), never from these cards.
type Props = {
  onPick: (id: string) => void;
  inUse?: string;
  defaults?: boolean;
  frame: Frame;
};

export function PromptList({ onPick, inUse, defaults = false, frame }: Props) {
  const store = useStore();
  const toast = useToast();
  const prompts = usePrompts();
  const connections = useConnections();
  const grouped = useMemo(() => groupPrompts(prompts), [prompts]);
  const settings = useSettings();
  const uses = usePromptUse();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState<PromptSort>('conversation');
  const [order, setOrder] = useState<Order>('name');
  const preset = usePresetImport(onPick);

  const badge = (prompt: Stored<'prompt'>) => defaultMark(isDefaultPrompt(settings, prompt), prompt.value.name);
  const tags = (id: string) => (id === inUse ? ['사용 중'] : []);
  // Only conversation prompts are used by chats; a translation prompt is chosen by a character's 번역.
  const usage = (prompt: Stored<'prompt'>) => (ofSort(prompt, 'conversation') ? promptUseWords(uses.get(prompt.id) ?? EMPTY_USE) : undefined);

  function add(sort: PromptSort) {
    const id = crypto.randomUUID();
    void addPrompt(store, NEW_NAME[sort], sort, id).then((added) => added.ok || toast.failed(added, '프롬프트를 만들지 못했어요.'));
    onPick(id);
  }

  const byName = (a: Stored<'prompt'>, b: Stored<'prompt'>) => Number(isDefaultPrompt(settings, b)) - Number(isDefaultPrompt(settings, a)) || byPromptName(a, b);
  const recentFirst = shown === 'conversation' && order === 'recent';
  const top = grouped.top.filter((prompt) => ofSort(prompt, shown)).sort(recentFirst ? byLastUse(uses, grouped.copies) : byName);
  const current = SORTS.find(({ sort }) => sort === shown)!;

  const row = (prompt: Stored<'prompt'>) => {
    const copies = grouped.copies.get(prompt.id) ?? [];
    const expanded = open.has(prompt.id);
    const flip = () => setOpen((current) => new Set(current.has(prompt.id) ? [...current].filter((id) => id !== prompt.id) : [...current, prompt.id]));
    return (
      <CardItem
        key={prompt.id}
        title={promptName(prompt.value.name)}
        badge={badge(prompt)}
        tags={tags(prompt.id)}
        aside={usage(prompt)}
        onClick={() => onPick(prompt.id)}
        control={
          copies.length > 0 && (
            <Button variant="ghost" size="sm" icon={expanded ? ChevronDown : ChevronRight} expanded={expanded} onClick={flip}>
              {`사본 ${copies.length}개`}
            </Button>
          )
        }
      >
        {expanded && copies.map(row)}
      </CardItem>
    );
  };

  const defaultCards = defaults && (
    <Section title="기본 프롬프트">
      <Columns>
        {SORTS.map(({ sort, label }) => {
          const prompt = prompts.find((each) => ofSort(each, sort) && isDefaultPrompt(settings, each));
          if (!prompt) return <PickCard key={sort} label={label} value="없음" tone="warn" onClick={() => setShown(sort)} />;
          const model = prompt.value.task && prompt.value.model;
          return <PickCard key={sort} label={label} value={promptName(prompt.value.name)} note={model ? taskModelWords(model, connections) : usage(prompt)} onClick={() => onPick(prompt.id)} />;
        })}
      </Columns>
    </Section>
  );

  const search = useSearch(prompts, '프롬프트 검색', (prompt) => [promptName(prompt.value.name)]);

  const adding = (
    <Button variant="secondary" icon={ACTS.create.icon} onClick={() => add(shown)}>
      {NEW_NAME[shown]}
    </Button>
  );
  const actions = (
    <Row kind="actions">
      <FileButton accept=".risup,.risupreset" icon={ACTS.import.icon} onFiles={(files) => preset.take(files)}>
        Risu 프리셋 가져오기
      </FileButton>
      {adding}
    </Row>
  );
  const body = (
    <>
      {defaultCards}
      <Row kind="spread">
        <Row kind="toolbar">
          {search.field}
          {!search.words && (
            <>
              <Tabs label="프롬프트 종류">
                {SORTS.map(({ sort, label }) => (
                  <Tab key={sort} label={label} count={prompts.filter((prompt) => ofSort(prompt, sort)).length} current={sort === shown} onClick={() => setShown(sort)} />
                ))}
              </Tabs>
              {current.hint && <Hint label={`${current.label} 프롬프트`}>{current.hint}</Hint>}
            </>
          )}
        </Row>
        {!search.words && shown === 'conversation' && (
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
      {search.words ? (
        search.none === null ? (
          <CardList label="검색 결과">
            {search.found.toSorted(byPromptName).map((prompt) => (
              <CardItem
                key={prompt.id}
                title={promptName(prompt.value.name)}
                badge={badge(prompt)}
                tags={[...(prompt.value.task ? [TASK_NAMES[prompt.value.task]] : []), ...tags(prompt.id)]}
                aside={usage(prompt)}
                onClick={() => onPick(prompt.id)}
              />
            ))}
          </CardList>
        ) : (
          <Empty variant="section">{search.none}</Empty>
        )
      ) : top.length ? (
        <CardList label={`${current.label} 프롬프트`}>{top.map(row)}</CardList>
      ) : (
        <Empty variant="section" action={adding}>
          {current.none}
        </Empty>
      )}
      {preset.view}
    </>
  );
  return frame({ head: { title: PAGES.prompts, actions }, body });
}
