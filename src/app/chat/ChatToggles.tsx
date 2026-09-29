import { useState } from 'react';
import type { Toggle } from '../../model/prompt';
import { noResults } from '../common/search';
import { Button, ChoiceGroup, Empty, Row, SearchField, Section, SettingRow, SidePanel, Stack, Switch, Text } from '../ui';
import { shownRows, type ToggleRow } from './toggles';
import type { OpenChat } from './useChat';

// Search and the 바꾼 것 filter show from this many toggles; fewer fit the panel at a glance.
const SEARCH_FROM = 8;

const defaultOf = (toggle: Toggle) => `처음 값: ${toggle.kind === 'check' ? (toggle.default === '1' ? '켬' : '끔') : (toggle.options[Number(toggle.default)] ?? toggle.default)}`;

// design §4.2 toggles: values are the character's, in every chat of it, or shared by every 캐릭터 없이 chat.
export function ChatToggles({ chat }: { chat: OpenChat }) {
  const { prompt, card, toggles, actions } = chat;
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'changed'>('all');
  const changedKeys = () => new Set([...toggles.prompt, ...toggles.card].filter((row) => row.changed).map((row) => row.toggle.key));
  const [first, setFirst] = useState(changedKeys);
  const total = toggles.prompt.length + toggles.card.length;

  const groups = [
    { title: prompt.kind === 'prompt' ? `프롬프트 · ${prompt.prompt.value.name}` : '프롬프트', rows: toggles.prompt },
    { title: `캐릭터 · ${card?.name ?? ''}`, rows: toggles.card },
  ]
    .filter((group) => group.rows.length > 0)
    .map((group) => ({ ...group, shown: shownRows(group.rows, query, filter === 'changed', first) }));
  const visible = groups.filter((group) => group.shown.length > 0);

  const row = ({ toggle, value, changed }: ToggleRow) => (
    <SettingRow
      key={toggle.key}
      place="panel"
      label={toggle.label}
      changed={changed}
      sub={changed ? defaultOf(toggle) : undefined}
      control={
        toggle.kind === 'check' ? (
          <Switch label={toggle.label} checked={value === '1'} onChange={(on) => actions.flip(toggle.key, on ? '1' : '0')} />
        ) : (
          <ChoiceGroup
            label={toggle.label}
            layout="segmented"
            options={toggle.options.map((label, index) => ({ value: String(index), label }))}
            value={value}
            onChange={(next) => actions.flip(toggle.key, next)}
          />
        )
      }
    />
  );

  return (
    <SidePanel
      title="토글"
      onClose={actions.closePanel}
      footer={
        <>
          {toggles.changed ? `처음 값과 다른 것 ${toggles.changed}개` : '모두 처음 값이에요'}
          <Button variant="secondary" size="sm" disabled={toggles.changed === 0} onClick={() => void actions.resetToggles()}>
            처음 값으로 되돌리기
          </Button>
        </>
      }
    >
      <Stack gap="related">
        <Text size="sm" tone="muted">
          {card
            ? `여기서 바꾼 값은 ${card.name}의 모든 채팅에 적용돼요. 처음 값은 프롬프트와 캐릭터 카드가 정해요.`
            : '여기서 바꾼 값은 캐릭터 없이 하는 모든 채팅에 적용돼요. 처음 값은 프롬프트가 정해요.'}
        </Text>
        {prompt.kind === 'prompt' && toggles.prompt.length > 0 && (
          <Row kind="actions">
            <Button variant="link" size="xs" onClick={() => actions.side({ kind: 'prompts', id: prompt.prompt.id, pane: 'toggles' })}>
              프롬프트 토글의 처음 값 바꾸기
            </Button>
          </Row>
        )}
      </Stack>
      {total >= SEARCH_FROM && (
        <Stack gap="related">
          <SearchField size="sm" label="토글 찾기" value={query} onChange={setQuery} />
          <ChoiceGroup
            label="보기"
            options={[
              { value: 'all', label: `전체 ${total}` },
              { value: 'changed', label: `바꾼 것 ${toggles.changed}` },
            ]}
            value={filter}
            onChange={(next) => {
              setFilter(next);
              setFirst(changedKeys());
            }}
          />
        </Stack>
      )}
      {visible.map((group) => (
        <Section key={group.title} level={3} title={group.title} note={String(group.rows.length)}>
          {group.shown.map(row)}
        </Section>
      ))}
      {total === 0 ? (
        <Empty variant="section">{card ? '이 채팅의 프롬프트와 캐릭터 카드에는 토글이 없어요.' : '이 채팅의 프롬프트에는 토글이 없어요.'}</Empty>
      ) : (
        visible.length === 0 && <Empty variant="section">{query.trim() ? noResults(query.trim()) : '처음 값과 다른 토글이 없어요.'}</Empty>
      )}
    </SidePanel>
  );
}
