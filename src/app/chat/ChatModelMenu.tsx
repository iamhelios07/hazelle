import { sameModelRef, type ModelRef } from '../../connectors/assignment';
import { recentModels } from '../../model/chat';
import { modelProfile } from '../../runtime/profiles';
import { starredModels } from '../common/RolePicker';
import { useSearch } from '../common/useSearch';
import { noStarred } from '../common/words';
import { useSummaries, useConnections, useStore } from '../session';
import { navigate } from '../shell/router';
import { ChipButton, Divider, Empty, Menu, MenuHeading, MenuItem, type MenuHandle } from '../ui';

type Props = {
  // null when no layer names one.
  current: ModelRef | null;
  label: string;
  onPick: (ref: ModelRef) => void;
  handle: MenuHandle;
};

const RECENT = 3;

// Starred models only, recent ones first. It never lists providers.
export function ChatModelMenu({ current, label, onPick, handle }: Props) {
  return (
    <Menu handle={handle} place="below-end" size="lg" label="모델" trigger={(opener) => <ChipButton label={label} title="모델 바꾸기" {...opener} />}>
      <ModelChoices current={current} onPick={onPick} />
      <Divider variant="menu" />
      {current && <ProfileItem current={current} />}
      <MenuItem tone="muted" label="모델 즐겨찾기 관리" onClick={() => navigate({ kind: 'connections' })} />
    </Menu>
  );
}

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
  const summaries = useSummaries();
  const starred = starredModels(connections, 'main');
  const recent = recentModels(
    summaries.map(({ value }) => value.recent),
    RECENT,
  ).flatMap((ref) => starred.filter((choice) => sameModelRef(choice.ref, ref)));
  const rest = starred.filter((choice) => !recent.includes(choice));
  const search = useSearch(starred, '즐겨찾기한 모델 검색', (choice) => [choice.name, choice.source]);

  const item = (choice: (typeof starred)[number]) => (
    <MenuItem key={`${choice.ref.connection}/${choice.ref.model}`} label={choice.name} sub={choice.source} checked={!!current && sameModelRef(choice.ref, current)} onClick={() => onPick(choice.ref)} />
  );

  if (starred.length === 0) return <Empty variant="menu">{noStarred('선택할 수 있어요')}</Empty>;
  return (
    <>
      {search.field}
      {search.words ? (
        search.none ? (
          <Empty variant="menu">{search.none}</Empty>
        ) : (
          <>
            <MenuHeading>검색 결과</MenuHeading>
            {search.found.map(item)}
          </>
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
              <MenuHeading>즐겨찾기</MenuHeading>
              {rest.map(item)}
            </>
          )}
        </>
      )}
    </>
  );
}
