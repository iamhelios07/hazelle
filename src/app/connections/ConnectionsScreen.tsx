import { resolveConnection } from '../../connectors/registry';
import type { Connection } from '../../connectors/types';
import { accountName } from '../../runtime/pool';
import { useConnections, useSession, useUnreadable } from '../session';
import { leftOf } from './ConnectionMeters';
import { backBar, navigate, useRoute } from '../shell/router';
import type { Back } from '../shell/routes';
import { ACTS, newOf } from '../common/acts';
import { useSearch } from '../common/useSearch';
import { PAGES } from '../common/words';
import { Button, Callout, Empty, List, ListItem, NavBar, Row, Screen } from '../ui';

// The default model is chosen on 설정's 모델 page, not here.
export function ConnectionsScreen({ back }: { back: Back | null }) {
  const connections = useConnections();
  const unreadable = useUnreadable();
  const route = useRoute();
  const { credentials } = useSession();
  const search = useSearch(connections, '연결 검색', (connection) => [connection.value.label]);

  // A pool names who would serve now and what it has left, from meters already read; nothing is fetched for the list.
  function summary(connection: Connection): string {
    const starred = connection.starred.length ? `즐겨찾기 ${connection.starred.length}개` : '즐겨찾기 없음';
    if (!connection.turns) return [connection.accounts[0]!.name, starred].filter(Boolean).join(' · ');
    const serving = credentials.pool.peek(connection);
    const held = serving && credentials.pool.held(connection, serving);
    const left = held && leftOf(held);
    return [`계정 ${connection.accounts.length}개`, ...(serving && left ? [`지금 ${accountName(serving)}`, left] : [starred])].join(' · ');
  }

  const adding = (
    <Button variant="secondary" icon={ACTS.create.icon} onClick={() => navigate({ kind: 'add-connection' })}>
      {newOf('연결')}
    </Button>
  );
  return (
    <Screen top={<NavBar title={PAGES.connections} {...backBar(back)} actions={adding} />}>
      {unreadable > 0 && <Callout tone="warn">암호화 키로 열리지 않는 항목 {unreadable}개는 목록에서 제외했어요.</Callout>}
      {search.field && <Row kind="toolbar">{search.field}</Row>}
      {search.none ? (
        <Empty variant="section">{search.none}</Empty>
      ) : connections.length > 0 ? (
        <List label="연결">
          {search.found.map((connection) => (
            <ListItem
              key={connection.id}
              title={connection.value.label}
              description={summary(connection.value)}
              tags={resolveConnection(connection.value) ? [] : ['지원하지 않는 연결']}
              current={route.kind === 'connection' && route.id === connection.id}
              onClick={() => navigate({ kind: 'connection', id: connection.id })}
            />
          ))}
        </List>
      ) : (
        <Empty variant="section" action={adding}>
          연결한 제공자가 없어요.
        </Empty>
      )}
    </Screen>
  );
}
