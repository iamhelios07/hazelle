import { useState } from 'react';
import type { Toggle } from '../../model/prompt';
import { ToggleChoice } from '../common/ToggleChoice';
import { useSearch } from '../common/useSearch';
import { PAGES, RESET } from '../common/words';
import { Button, Empty, Row, Section, SettingRow, SidePanel, Stack, Switch, Tab, Tabs, Text } from '../ui';
import { shownRows, splitByCard, type ToggleRow } from './toggles';
import type { OpenChat } from './useChat';

const defaultOf = (toggle: Toggle) => `기본값: ${toggle.kind === 'check' ? (toggle.default === '1' ? '켬' : '끔') : (toggle.options[Number(toggle.default)] ?? toggle.default)}`;

export function ChatToggles({ chat }: { chat: OpenChat }) {
  const { prompt, card, toggles, actions } = chat;
  const [filter, setFilter] = useState<'all' | 'changed'>('all');
  const changedKeys = () => new Set([...toggles.prompt, ...toggles.card].filter((row) => row.changed).map((row) => row.toggle.key));
  const [first, setFirst] = useState(changedKeys);
  const all = [...toggles.prompt, ...toggles.card];
  const search = useSearch(all, '토글 검색', (row) => [row.toggle.label]);
  const found = new Set(search.found);
  const packs = splitByCard(toggles.card, card?.toggles ?? '');

  const groups = [
    { title: prompt.kind === 'prompt' ? `프롬프트 · ${prompt.prompt.value.name}` : '프롬프트', rows: toggles.prompt },
    { title: `캐릭터 · ${card?.name ?? ''}`, rows: packs.card },
    { title: PAGES.modules, rows: packs.modules },
  ]
    .filter((group) => group.rows.length > 0)
    .map((group) => ({ ...group, shown: shownRows(group.rows, found, filter === 'changed', first) }));
  const visible = groups.filter((group) => group.shown.length > 0);

  function show(next: typeof filter) {
    setFilter(next);
    setFirst(changedKeys());
  }

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
          <ToggleChoice label={toggle.label} options={toggle.options} value={value} onChange={(next) => actions.flip(toggle.key, next)} />
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
          {toggles.changed ? `변경 ${toggles.changed}개` : '모두 기본값'}
          <Button variant="link" size="sm" disabled={toggles.changed === 0} onClick={actions.resetToggles}>
            {RESET}
          </Button>
        </>
      }
    >
      <Stack gap="related">
        <Text variant="note">
          {card
            ? `여기서 바꾼 값은 ${card.name}의 모든 채팅에 적용돼요.`
            : '여기서 바꾼 값은 캐릭터 없는 모든 채팅에 적용돼요.'}
        </Text>
        {prompt.kind === 'prompt' && toggles.prompt.length > 0 && (
          <Row kind="actions">
            <Button variant="link" size="xs" onClick={() => actions.side({ kind: 'prompts', id: prompt.prompt.id, pane: 'toggles' })}>
              프롬프트 토글의 기본값 바꾸기
            </Button>
          </Row>
        )}
      </Stack>
      {search.field && (
        <Row kind="toolbar">
          {search.field}
          <Tabs label="보기">
            <Tab label="전체" count={all.length} current={filter === 'all'} onClick={() => show('all')} />
            <Tab label="변경" count={toggles.changed} current={filter === 'changed'} onClick={() => show('changed')} />
          </Tabs>
        </Row>
      )}
      {visible.map((group) => (
        <Section key={group.title} level={3} title={group.title} note={String(group.rows.length)}>
          {group.shown.map(row)}
        </Section>
      ))}
      {all.length === 0 ? (
        <Empty variant="section">{card ? '이 채팅의 프롬프트와 캐릭터 카드에는 토글이 없어요.' : '이 채팅의 프롬프트에는 토글이 없어요.'}</Empty>
      ) : (
        visible.length === 0 && <Empty variant="section">{search.none ?? '변경한 토글이 없어요.'}</Empty>
      )}
    </SidePanel>
  );
}
