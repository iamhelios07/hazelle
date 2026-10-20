import { Bell, ListFilter, PenLine } from 'lucide-react';
import { useState } from 'react';
import { CATEGORIES, STATUSES, type Category, type Sort, type Status } from '../../contracts/board';
import { BOARD } from '../common/words';
import { useStanding } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, ChoiceGroup, IconButton, Menu, MenuItem, NavBar, Row, Screen, Tabs } from '../ui';
import { useNicknameGate } from './nickname';
import { PostList } from './parts';

const ALL = 'all';
const SORTS: { value: Sort; label: string }[] = [{ value: 'new', label: '최신' }, { value: 'top', label: BOARD.vote }];

// operator: the operator-only posts, the only ones a suspended account reads (design §6.13).
export function BoardScreen({ operator, back }: { operator: boolean; back: Back | null }) {
  const { unreadBoard, suspended } = useStanding();
  const { gate, dialog } = useNicknameGate();
  const [category, setCategory] = useState<Category | typeof ALL>(ALL);
  const [sort, setSort] = useState<Sort>('new');
  const [status, setStatus] = useState<Status | null>(null);
  const onlyOperator = operator || suspended;
  const ask = { sort, category: category === ALL ? undefined : category, status: status ?? undefined, visibility: onlyOperator ? ('operator' as const) : undefined };
  return (
    <Screen
      width="form"
      top={
        <NavBar
          title={onlyOperator ? BOARD.operatorOnly : BOARD.title}
          {...backBar(back)}
          actions={
            <>
              <IconButton icon={Bell} label={BOARD.activity} size="sm" count={unreadBoard} onClick={() => navigate({ kind: 'board-activity' })} />
              <Button variant="secondary" onClick={() => navigate({ kind: 'board-mine' })}>
                {BOARD.mine}
              </Button>
              <Button variant="secondary" icon={PenLine} onClick={() => gate(() => navigate({ kind: 'board-write', operator: onlyOperator }))}>
                {BOARD.write}
              </Button>
            </>
          }
        />
      }
    >
      <Tabs label="분류" items={[{ value: ALL, label: '전체' }, ...CATEGORIES.map((value) => ({ value, label: BOARD.categories[value] }))]} value={category} onChange={setCategory} />
      <Row kind="spread">
        <ChoiceGroup label="정렬" options={SORTS} value={sort} onChange={setSort} layout="segmented" />
        <Menu
          label="상태 필터"
          place="below-end"
          trigger={(opener) => (
            <Button variant="ghost" size="sm" icon={ListFilter} {...opener}>
              {status === null ? '필터' : `필터 · ${BOARD.statuses[status]}`}
            </Button>
          )}
        >
          <MenuItem label="모든 상태" checked={status === null} onClick={() => setStatus(null)} />
          {STATUSES.map((each) => (
            <MenuItem key={each} label={BOARD.statuses[each]} checked={status === each} onClick={() => setStatus(each)} />
          ))}
        </Menu>
      </Row>
      <PostList key={JSON.stringify(ask)} ask={ask} label={BOARD.title} empty="글이 없어요." />
      {dialog}
    </Screen>
  );
}
