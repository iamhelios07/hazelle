import { ChevronDown, ChevronRight, Import, Plus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { Stored } from '../../model/kinds';
import { addPrompt } from '../../runtime/prompts';
import { noResults } from '../common/search';
import { ago } from '../common/time';
import { useStore, useViews } from '../session';
import { useToast } from '../toast';
import { Button, Empty, FileButton, List, ListItem, Row, SearchField, Section, Stack, Text, Tile, Tiles, type NavBarProps } from '../ui';
import { usePresetImport } from './PresetImport';
import { EMPTY_USE, promptName, usePromptUse, type PromptUse } from './usePromptUse';

const RECENT = 4;

const useWords = (use: PromptUse) => (use.chats ? `채팅 ${use.chats}개` : '쓰는 채팅 없음');
const used = (use: PromptUse) => (use.at === null ? useWords(use) : `${useWords(use)} · ${ago(use.at)} 씀`);

type Props = {
  // A prompt made or imported here is picked as soon as it is saved.
  onPick: (id: string) => void;
  // The one a chat uses, marked 사용 중.
  inUse?: string;
  frame: (parts: { head: NavBarProps; body: ReactNode }) => ReactNode;
};

// design §4.2: a list made for dozens. Search, the ones used last, and every prompt with its copies under it.
export function PromptList({ onPick, inUse, frame }: Props) {
  const store = useStore();
  const toast = useToast();
  const { prompts, settings } = useViews();
  const uses = usePromptUse();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const preset = usePresetImport(onPick);

  const use = (id: string) => uses.get(id) ?? EMPTY_USE;
  const badge = (id: string) => (id === settings.prompt ? '기본' : undefined);
  const tags = (id: string) => (id === inUse ? ['사용 중'] : []);
  const byName = (a: Stored<'prompt'>, b: Stored<'prompt'>) => a.value.name.localeCompare(b.value.name, 'ko');

  async function add() {
    setAdding(true);
    const added = await addPrompt(store, '새 프롬프트');
    setAdding(false);
    if (!added.ok) return toast.failed(added, '프롬프트를 만들지 못했어요.');
    onPick(added.data.id);
  }

  const ids = new Set(prompts.map((prompt) => prompt.id));
  // A copy sits under its original while that is still here.
  const copiesOf = (id: string) => prompts.filter((prompt) => prompt.value.origin?.id === id).sort(byName);
  const top = prompts.filter((prompt) => !prompt.value.origin || !ids.has(prompt.value.origin.id)).sort((a, b) => Number(b.id === settings.prompt) - Number(a.id === settings.prompt) || byName(a, b));
  const recent = prompts
    .filter((prompt) => use(prompt.id).at !== null)
    .sort((a, b) => use(b.id).at! - use(a.id).at!)
    .slice(0, RECENT);

  const row = (prompt: Stored<'prompt'>) => {
    const copies = copiesOf(prompt.id);
    const expanded = open.has(prompt.id);
    const flip = () => setOpen((current) => new Set(current.has(prompt.id) ? [...current].filter((id) => id !== prompt.id) : [...current, prompt.id]));
    return (
      <ListItem
        key={prompt.id}
        title={promptName(prompt.value.name)}
        badge={badge(prompt.id)}
        tags={tags(prompt.id)}
        description={used(use(prompt.id))}
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
  const found = prompts.filter((prompt) => promptName(prompt.value.name).toLowerCase().includes(words)).sort(byName);

  const actions = (
    <Row kind="actions">
      <FileButton accept=".risup" size="sm" icon={Import} onFile={(file) => preset.take([file])}>
        Risu 프리셋 가져오기
      </FileButton>
      <Button size="sm" icon={Plus} busy={adding} onClick={() => void add()}>
        새 프롬프트
      </Button>
    </Row>
  );
  const body = (
    <>
      <Stack gap="related">
        <SearchField label="이름으로 찾기" value={query} onChange={setQuery} />
        <Text size="sm" tone="muted">
          Risu 프리셋(.risup) 파일을 이 화면에 끌어 놓아도 새 프롬프트로 가져와요.
        </Text>
      </Stack>
      {words ? (
        found.length ? (
          <List label="검색 결과">
            {found.map((prompt) => (
              <ListItem key={prompt.id} title={promptName(prompt.value.name)} badge={badge(prompt.id)} tags={tags(prompt.id)} description={used(use(prompt.id))} onClick={() => onPick(prompt.id)} />
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
                  <Tile key={prompt.id} title={promptName(prompt.value.name)} badge={badge(prompt.id)} meta={used(use(prompt.id))} onClick={() => onPick(prompt.id)} />
                ))}
              </Tiles>
            </Section>
          )}
          <Section title={`모든 프롬프트 ${prompts.length}개`}>
            {prompts.length ? <List label="모든 프롬프트">{top.map(row)}</List> : <Empty variant="section">아직 프롬프트가 없어요. 새로 만들거나 Risu 프리셋을 가져와 보세요.</Empty>}
          </Section>
        </>
      )}
      {preset.view}
    </>
  );
  return frame({ head: { title: '프롬프트', actions }, body });
}
