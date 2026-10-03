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
import { Button, Empty, FileButton, List, ListItem, Row, SearchField, Section, Stack, Tile, Tiles } from '../ui';
import { usePresetImport } from './PresetImport';
import { EMPTY_USE, usePromptUse, type PromptUse } from './usePromptUse';
import { byPromptName, groupPrompts } from './copies';

const RECENT = 4;
const NEW_NAME = { conversation: '새 프롬프트', translate: '새 번역 프롬프트', memory: '새 기억 프롬프트' } satisfies Record<PromptSort, string>;

const useWords = (use: PromptUse) => (use.chats ? `채팅 ${use.chats}개` : '쓰는 채팅 없음');
const used = (use: PromptUse) => (use.at === null ? useWords(use) : `${useWords(use)} · ${ago(use.at)} 씀`);

type Props = {
  // A prompt made or imported here is picked as soon as it is saved.
  onPick: (id: string) => void;
  // The one a chat uses, marked 사용 중.
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
  const [adding, setAdding] = useState<PromptSort | null>(null);
  const preset = usePresetImport(onPick);

  const use = (id: string) => uses.get(id) ?? EMPTY_USE;
  const badge = (prompt: Stored<'prompt'>) => (isDefaultPrompt(settings, prompt) ? '기본' : undefined);
  const tags = (id: string) => (id === inUse ? ['사용 중'] : []);
  // Only conversation prompts are used by chats; a translation prompt is chosen by a character's 번역.
  const description = (prompt: Stored<'prompt'>) => (ofSort(prompt, 'conversation') ? used(use(prompt.id)) : undefined);

  async function add(sort: PromptSort) {
    setAdding(sort);
    const added = await addPrompt(store, NEW_NAME[sort], sort);
    setAdding(null);
    if (!added.ok) return toast.failed(added, '프롬프트를 만들지 못했어요.');
    onPick(added.data.id);
  }

  const topOf = (sort: PromptSort) =>
    grouped.top
      .filter((prompt) => ofSort(prompt, sort))
      .sort((a, b) => Number(isDefaultPrompt(settings, b)) - Number(isDefaultPrompt(settings, a)) || byPromptName(a, b));
  const conversations = prompts.filter((prompt) => ofSort(prompt, 'conversation'));
  const translators = prompts.filter((prompt) => ofSort(prompt, 'translate'));
  const memorizers = prompts.filter((prompt) => ofSort(prompt, 'memory'));
  const recent = conversations
    .filter((prompt) => use(prompt.id).at !== null)
    .sort((a, b) => use(b.id).at! - use(a.id).at!)
    .slice(0, RECENT);

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
        description={description(prompt)}
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
      <Button size="sm" icon={Plus} busy={adding === 'conversation'} onClick={() => void add('conversation')}>
        새 프롬프트
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
                description={description(prompt)}
                onClick={() => onPick(prompt.id)}
              />
            ))}
          </List>
        ) : (
          <Empty>{noResults(query.trim())}</Empty>
        )
      ) : (
        <>
          {recent.length > 0 && (
            <Section title="최근 사용">
              <Tiles label="최근 사용">
                {recent.map((prompt) => (
                  <Tile key={prompt.id} title={promptName(prompt.value.name)} badge={badge(prompt)} meta={used(use(prompt.id))} onClick={() => onPick(prompt.id)} />
                ))}
              </Tiles>
            </Section>
          )}
          <Section title={`대화 프롬프트 ${conversations.length}개`}>
            {conversations.length ? (
              <List label="대화 프롬프트">{topOf('conversation').map(row)}</List>
            ) : (
              <Empty variant="section">아직 대화 프롬프트가 없어요. 새로 만들거나 Risu 프리셋을 가져와 보세요.</Empty>
            )}
          </Section>
          <Section
            title={`번역 프롬프트 ${translators.length}개`}
            hint="답장 번역과 보낼 말 번역이 쓰는 프롬프트예요. 글 속 {{language}}에는 번역할 언어가 들어가요."
            action={
              <Button variant="ghost" size="xs" icon={Plus} busy={adding === 'translate'} onClick={() => void add('translate')}>
                새 번역 프롬프트
              </Button>
            }
          >
            {translators.length ? <List label="번역 프롬프트">{topOf('translate').map(row)}</List> : <Empty variant="section">번역 프롬프트가 없어요. 새로 만들어 보세요.</Empty>}
          </Section>
          <Section
            title={`기억 프롬프트 ${memorizers.length}개`}
            hint="지난 메시지를 장기 기억으로 정리할 때 쓰는 프롬프트예요. 모든 채팅이 기본으로 정한 하나로 정리해요."
            action={
              <Button variant="ghost" size="xs" icon={Plus} busy={adding === 'memory'} onClick={() => void add('memory')}>
                새 기억 프롬프트
              </Button>
            }
          >
            {memorizers.length ? <List label="기억 프롬프트">{topOf('memory').map(row)}</List> : <Empty variant="section">기억 프롬프트가 없어요. 새로 만들어 보세요.</Empty>}
          </Section>
        </>
      )}
      {preset.view}
    </>
  );
  return frame({ head: { title: PAGES.prompts, actions }, body });
}
