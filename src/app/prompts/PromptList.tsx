import { ChevronDown, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Stored } from '../../model/kinds';
import type { PromptSort } from '../../model/prompt';
import { availableFeatures } from '../../runtime/features';
import { addPrompt, isDefaultPrompt, ofSort } from '../../runtime/prompts';
import { ACTS } from '../common/acts';
import type { Frame } from '../common/frame';
import { TASK_NAMES } from '../common/prompt-words';
import { useSearch } from '../common/useSearch';
import { useConnections, usePrompts, useSettings, useStore } from '../session';
import { useToast } from '../toast';
import { defaultMark, EMPTY_FOLDER, MODEL_ROLES, PAGES, PRE_READ, promptName } from '../common/words';
import { Button, CardItem, CardList, ChoiceGroup, Columns, Empty, Hint, PickCard, Row, Section, Tabs } from '../ui';
import { taskModelWords } from './ModelPane';
import { useImport } from '../common/importing';
import { EMPTY_USE, promptUseWords, usePromptUse } from '../common/usePromptUse';
import { byLastUse, byPromptName, groupPrompts, promptFolder as folderOf } from '../common/promptCopies';
import { folderNote, placeIn, useFolderIndex, whereIs } from '../common/folders/filing';
import { FolderMenu, FolderPath, useMoving, useNaming } from '../common/folders/FolderParts';

const NEW_NAME = { conversation: '새 프롬프트', translate: '새 번역 프롬프트', memory: '새 기억 프롬프트', illustrate: '새 삽화 프롬프트', mascot: '새 마스코트 프롬프트', preread: `새 ${PRE_READ} 프롬프트` } satisfies Record<PromptSort, string>;
const SORTS: { sort: PromptSort; label: string; hint?: string; none: string }[] = [
  { sort: 'conversation', label: '대화', none: '대화 프롬프트가 없어요.' },
  { sort: 'translate', label: '번역', hint: '받은 응답과 보낼 메시지를 번역할 때 쓰는 프롬프트예요.', none: '번역 프롬프트가 없어요.' },
  { sort: 'memory', label: '기억', hint: '지난 대화를 장기 기억으로 정리할 때 쓰는 프롬프트예요.', none: '기억 프롬프트가 없어요.' },
  { sort: 'illustrate', label: '삽화', hint: '메시지에 넣을 삽화의 장면을 정할 때 쓰는 프롬프트예요.', none: '삽화 프롬프트가 없어요.' },
  { sort: 'mascot', label: '마스코트', hint: '응답마다 마스코트가 한마디 할 때 쓰는 프롬프트예요.', none: '마스코트 프롬프트가 없어요.' },
  { sort: 'preread', label: PRE_READ, hint: `응답마다 ${MODEL_ROLES.aux}이 긴 내용을 먼저 줄일 때 쓰는 프롬프트예요.`, none: `${PRE_READ} 프롬프트가 없어요.` },
];
type Order = 'name' | 'recent';

// defaults: each kind's default leads the list, as a card that opens it. The default is chosen on the prompt's own
// page (기본으로 정하기), never from these cards. place: the folder the 대화 tab stands in.
type Props = {
  onPick: (id: string) => void;
  inUse?: string;
  defaults?: boolean;
  place: string | null;
  onGo: (place: string | null) => void;
  frame: Frame;
};

export function PromptList({ onPick, inUse, defaults = false, place, onGo, frame }: Props) {
  const store = useStore();
  const toast = useToast();
  const prompts = usePrompts();
  const connections = useConnections();
  const grouped = useMemo(() => groupPrompts(prompts), [prompts]);
  const settings = useSettings();
  // An experiment's prompts show only while its 실험실 switch is on.
  const sorts = useMemo(() => {
    const available = availableFeatures(settings);
    return SORTS.filter(({ sort }) => sort === 'conversation' || available.includes(sort));
  }, [settings]);
  const listed = useMemo(() => prompts.filter((prompt) => sorts.some(({ sort }) => ofSort(prompt, sort))), [prompts, sorts]);
  const uses = usePromptUse();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShown] = useState<PromptSort>('conversation');
  const [order, setOrder] = useState<Order>('name');
  const { pickPrompts } = useImport();
  const conversations = useMemo(() => grouped.top.filter((prompt) => ofSort(prompt, 'conversation')), [grouped]);
  const index = useFolderIndex('prompt', conversations, folderOf);
  const filing = shown === 'conversation';
  const at = placeIn(index, place, false);
  const naming = useNaming('prompt');
  // A prompt moves with the copies listed under it.
  const carry = (id: string): string[] => [id, ...(grouped.copies.get(id) ?? []).flatMap((copy) => carry(copy.id))];
  const filedAt = (id: string) => {
    const prompt = prompts.find((each) => each.id === id);
    return prompt ? folderOf(prompt) : null;
  };
  const moving = useMoving('prompt', index, filedAt, { off: !filing, carry });

  const badge = (prompt: Stored<'prompt'>) => defaultMark(isDefaultPrompt(settings, prompt), prompt.value.name);
  const tags = (id: string) => (id === inUse ? ['사용 중'] : []);
  // Only conversation prompts are used by chats; a translation prompt is chosen by a character's 번역.
  const usage = (prompt: Stored<'prompt'>) => (ofSort(prompt, 'conversation') ? promptUseWords(uses.get(prompt.id) ?? EMPTY_USE) : undefined);

  function add(sort: PromptSort) {
    const id = crypto.randomUUID();
    const folder = sort === 'conversation' ? at.here?.folder.id : undefined;
    void addPrompt(store, NEW_NAME[sort], sort, id, folder).then((added) => added.ok || toast.failed(added, '프롬프트를 만들지 못했어요.'));
    onPick(id);
  }

  const byName = (a: Stored<'prompt'>, b: Stored<'prompt'>) => Number(isDefaultPrompt(settings, b)) - Number(isDefaultPrompt(settings, a)) || byPromptName(a, b);
  const recentFirst = shown === 'conversation' && order === 'recent';
  const top = (filing ? at.placed(conversations) : grouped.top.filter((prompt) => ofSort(prompt, shown))).sort(recentFirst ? byLastUse(uses, grouped.copies) : byName);
  const current = sorts.find(({ sort }) => sort === shown)!;

  const row = (prompt: Stored<'prompt'>, nested = false) => {
    const copies = grouped.copies.get(prompt.id) ?? [];
    const expanded = open.has(prompt.id);
    const flip = () => setOpen((current) => new Set(current.has(prompt.id) ? [...current].filter((id) => id !== prompt.id) : [...current, prompt.id]));
    const picking = moving.picked !== null && !nested;
    return (
      <CardItem
        key={prompt.id}
        title={promptName(prompt.value.name)}
        badge={badge(prompt)}
        tags={tags(prompt.id)}
        note={usage(prompt)}
        selected={picking ? moving.picked!.has(prompt.id) : undefined}
        drag={moving.dropInto && !nested ? prompt.id : undefined}
        onClick={() => (picking ? moving.toggle(prompt.id) : onPick(prompt.id))}
        control={
          copies.length > 0 && (
            <Button variant="ghost" size="sm" icon={expanded ? ChevronDown : ChevronRight} expanded={expanded} onClick={flip}>
              {`사본 ${copies.length}개`}
            </Button>
          )
        }
      >
        {expanded && copies.map((copy) => row(copy, true))}
      </CardItem>
    );
  };

  const folderRows = filing ? at.folders.map((folder) => (
    <CardItem
      key={folder.id}
      folder
      title={folder.value.name}
      note={folderNote('prompt', index.byFolder.get(folder.id)!)}
      onClick={() => onGo(folder.id)}
      onDropCard={moving.dropInto?.(folder.id)}
      control={<FolderMenu kind="prompt" folder={folder} depth={at.path.length + 1} onName={naming.name} />}
    />
  )) : [];

  const defaultCards = defaults && (
    <Section title="기본 프롬프트">
      <Columns>
        {sorts.map(({ sort, label }) => {
          const prompt = prompts.find((each) => ofSort(each, sort) && isDefaultPrompt(settings, each));
          if (!prompt) return <PickCard key={sort} label={label} value="없음" tone="warn" onClick={() => setShown(sort)} />;
          const model = prompt.value.task && prompt.value.model;
          return <PickCard key={sort} label={label} value={promptName(prompt.value.name)} note={model ? taskModelWords(model, connections) : usage(prompt)} onClick={() => onPick(prompt.id)} />;
        })}
      </Columns>
    </Section>
  );

  const search = useSearch(listed, '프롬프트 검색', (prompt) => [promptName(prompt.value.name)]);

  const adding = (
    <Button variant="secondary" icon={ACTS.create.icon} onClick={() => add(shown)}>
      {NEW_NAME[shown]}
    </Button>
  );
  const actions = (
    <Row kind="actions">
      <Button variant="secondary" icon={ACTS.import.icon} onClick={pickPrompts}>
        Risu 프리셋 가져오기
      </Button>
      {adding}
    </Row>
  );
  const body = (
    <>
      {defaultCards}
      <Row kind="toolbar">
        {search.field}
        {!search.words && (
          <>
            <Tabs
              label="프롬프트 종류"
              items={sorts.map(({ sort, label }) => ({ value: sort, label, count: prompts.filter((prompt) => ofSort(prompt, sort)).length }))}
              value={shown}
              onChange={setShown}
            />
            {current.hint && <Hint label={`${current.label} 프롬프트`}>{current.hint}</Hint>}
            {shown === 'conversation' && (
              <ChoiceGroup
                label="정렬"
                showLabel
                layout="segmented"
                options={[
                  { value: 'name', label: '이름' },
                  { value: 'recent', label: '최근 사용' },
                ]}
                value={order}
                onChange={setOrder}
              />
            )}
          </>
        )}
      </Row>
      {search.shown(
        <>
          {filing && (
            <FolderPath kind="prompt" path={at.path} onGo={onGo} onName={naming.name} dropInto={moving.dropInto}>
              {moving.button}
            </FolderPath>
          )}
          {folderRows.length + top.length > 0 ? (
            <CardList label={`${current.label} 프롬프트`}>
              {folderRows}
              {top.map((prompt) => row(prompt))}
            </CardList>
          ) : at.here && filing ? (
            <Empty>{EMPTY_FOLDER}</Empty>
          ) : (
            <Empty action={adding}>
              {current.none}
            </Empty>
          )}
        </>,
        (found) => (
          <CardList label="검색 결과">
            {found.toSorted(byPromptName).map((prompt) => (
              <CardItem
                key={prompt.id}
                title={promptName(prompt.value.name)}
                badge={badge(prompt)}
                tags={[...(prompt.value.task ? [TASK_NAMES[prompt.value.task]] : []), ...tags(prompt.id)]}
                note={[whereIs(index, folderOf(prompt)), usage(prompt)].filter(Boolean).join(' · ') || undefined}
                onClick={() => onPick(prompt.id)}
              />
            ))}
          </CardList>
        ),
        'body',
      )}
      {moving.bar}
      {naming.dialog}
    </>
  );
  return frame({ head: { title: PAGES.prompts, actions }, body });
}
