import { useState } from 'react';
import { fitsRole, type ModelRef } from '../../connectors/assignment';
import { recentModels } from '../../model/chat';
import { navigate } from '../router';
import { useChats, useConnections } from '../session';
import { ChipButton, MenuDivider, MenuHeading, MenuItem, MenuNote, Popover, SearchField } from '../ui';

type Props = {
  open: boolean;
  onOpen: (open: boolean) => void;
  // The model now in use, and its name for the button; null when no layer names one.
  current: ModelRef | null;
  label: string;
  onPick: (ref: ModelRef) => void;
};

const RECENT = 3;
const same = (a: ModelRef, b: ModelRef | null) => b !== null && a.connection === b.connection && a.model === b.model;

// F4: starred models only, recent ones first, with the connection as a badge. It never lists providers.
export function ChatModelMenu({ open, onOpen, current, label, onPick }: Props) {
  const connections = useConnections();
  const chats = useChats();
  const [query, setQuery] = useState('');

  const starred = connections.flatMap((connection) =>
    connection.value.starred.filter((model) => fitsRole(model, 'main')).map((model) => ({ ref: { connection: connection.id, model: model.id }, name: model.name, source: connection.value.label })),
  );
  const recent = recentModels(
    chats.map((item) => item.messages),
    RECENT,
  ).flatMap((ref) => starred.filter((choice) => same(choice.ref, ref)));
  const rest = starred.filter((choice) => !recent.includes(choice));
  const words = query.trim().toLowerCase();
  const found = starred.filter((choice) => `${choice.name} ${choice.source}`.toLowerCase().includes(words));

  const close = () => {
    onOpen(false);
    setQuery('');
  };
  const item = (choice: (typeof starred)[number]) => (
    <MenuItem
      key={`${choice.ref.connection}/${choice.ref.model}`}
      label={choice.name}
      sub={choice.source}
      checked={same(choice.ref, current)}
      onClick={() => {
        onPick(choice.ref);
        close();
      }}
    />
  );

  return (
    <Popover
      open={open}
      onClose={close}
      place="below-end"
      size="lg"
      label="모델"
      trigger={<ChipButton label={label} title="모델 바꾸기" expanded={open} onClick={() => (open ? close() : onOpen(true))} />}
    >
      {starred.length === 0 ? (
        <MenuNote>별표 찍은 모델이 없어요. 연결에서 모델에 별표를 찍으면 여기서 고를 수 있어요.</MenuNote>
      ) : (
        <>
          <SearchField size="sm" label="별표 모델 검색" value={query} onChange={setQuery} />
          {words ? (
            found.length ? (
              <>
                <MenuHeading>검색 결과</MenuHeading>
                {found.map(item)}
              </>
            ) : (
              <MenuNote>“{query.trim()}” 검색 결과가 없어요. 별표 찍은 모델만 찾아요.</MenuNote>
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
      )}
      <MenuDivider />
      <MenuItem tone="muted" label="연결에서 모델 더 별표하기" onClick={() => navigate('/connections')} />
    </Popover>
  );
}
