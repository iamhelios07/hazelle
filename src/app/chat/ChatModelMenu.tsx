import { useState } from 'react';
import { fitsRole, type ModelRef } from '../../connectors/assignment';
import { recentModels } from '../../model/chat';
import { modelProfile } from '../../runtime/profiles';
import { noResults } from '../common/search';
import { noStarred } from '../common/words';
import { useChatMessages, useConnections, useStore } from '../session';
import { navigate } from '../shell/router';
import { ChipButton, Divider, Empty, Menu, MenuHeading, MenuItem, SearchField, type MenuHandle } from '../ui';

type Props = {
  // The model now in use, and its name for the button; null when no layer names one.
  current: ModelRef | null;
  label: string;
  onPick: (ref: ModelRef) => void;
  // A failed reply's 다른 모델로 opens it too.
  handle: MenuHandle;
};

const RECENT = 3;
const same = (a: ModelRef, b: ModelRef | null) => b !== null && a.connection === b.connection && a.model === b.model;

// Starred models only, recent ones first. It never lists providers.
export function ChatModelMenu({ current, label, onPick, handle }: Props) {
  return (
    <Menu handle={handle} place="below-end" size="lg" label="모델" trigger={(opener) => <ChipButton label={label} title="모델 바꾸기" {...opener} />}>
      <ModelChoices current={current} onPick={onPick} />
      <Divider variant="menu" />
      {current && <ProfileItem current={current} />}
      <MenuItem tone="muted" label="연결에서 모델 더 별표하기" onClick={() => navigate({ kind: 'connections' })} />
    </Menu>
  );
}

// The settings the current model uses, opening its page; nothing while current names a model no longer starred.
function ProfileItem({ current }: { current: ModelRef }) {
  const store = useStore();
  const connections = useConnections();
  const starred = connections.find((connection) => connection.id === current.connection)?.value.starred.find((model) => model.id === current.model);
  if (!starred) return null;
  const choice = modelProfile(store, starred);
  const name = choice.kind === 'profile' ? choice.profile.value.name : '없음';
  return <MenuItem tone="muted" label={`모델 설정 · ${name}`} onClick={() => navigate({ kind: 'model', ...current })} />;
}

// Mounted only while the menu is open, so each opening starts with an empty search.
function ModelChoices({ current, onPick }: Pick<Props, 'current' | 'onPick'>) {
  const connections = useConnections();
  const messages = useChatMessages();
  const [query, setQuery] = useState('');

  const starred = connections.flatMap((connection) =>
    connection.value.starred.filter((model) => fitsRole(model, 'main')).map((model) => ({ ref: { connection: connection.id, model: model.id }, name: model.name, source: connection.value.label })),
  );
  const recent = recentModels(
    messages,
    RECENT,
  ).flatMap((ref) => starred.filter((choice) => same(choice.ref, ref)));
  const rest = starred.filter((choice) => !recent.includes(choice));
  const words = query.trim().toLowerCase();
  const found = starred.filter((choice) => `${choice.name} ${choice.source}`.toLowerCase().includes(words));

  const item = (choice: (typeof starred)[number]) => (
    <MenuItem key={`${choice.ref.connection}/${choice.ref.model}`} label={choice.name} sub={choice.source} checked={same(choice.ref, current)} onClick={() => onPick(choice.ref)} />
  );

  if (starred.length === 0) return <Empty variant="menu">{noStarred('고를 수 있어요')}</Empty>;
  return (
    <>
      <SearchField size="sm" label="별표한 모델 검색" value={query} onChange={setQuery} />
      {words ? (
        found.length ? (
          <>
            <MenuHeading>검색 결과</MenuHeading>
            {found.map(item)}
          </>
        ) : (
          <Empty variant="menu">{`${noResults(query.trim())} 별표한 모델만 찾아요.`}</Empty>
        )
      ) : (
        <>
          {recent.length > 0 && (
            <>
              <MenuHeading>최근</MenuHeading>
              {recent.map(item)}
            </>
          )}
          {rest.length > 0 && (
            <>
              <MenuHeading>별표</MenuHeading>
              {rest.map(item)}
            </>
          )}
        </>
      )}
    </>
  );
}
