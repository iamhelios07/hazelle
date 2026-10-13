import { resolveConnection } from '../../connectors/registry';
import type { Connection } from '../../connectors/types';
import { accountName } from '../../runtime/pool';
import { useConnections, useSession, useUnreadable } from '../session';
import { LeftGauge } from './ConnectionMeters';
import { backBar, navigate, useRoute } from '../shell/router';
import type { Back } from '../shell/routes';
import { ACTS, newOf } from '../common/acts';
import { useSearch } from '../common/useSearch';
import { PAGES } from '../common/words';
import { Button, Callout, Columns, Empty, ItemCard, NavBar, Row, Screen } from '../ui';

// The default model is chosen on 설정's 모델 page, not here.
export function ConnectionsScreen({ back }: { back: Back | null }) {
  const connections = useConnections();
  const unreadable = useUnreadable();
  const route = useRoute();
  const { credentials } = useSession();
  const search = useSearch(connections, '연결 검색', (connection) => [connection.value.label]);

  // A pool names who would serve now and what it has left, from meters already read; nothing is fetched for the list.
  function card(connection: Connection) {
    const starred = connection.starred.length ? `즐겨찾기 ${connection.starred.length}개` : '즐겨찾기 없음';
    if (!connection.turns) return { description: [connection.accounts[0]!.name, starred].filter(Boolean).join(' · ') };
    const serving = credentials.pool.peek(connection);
    const held = serving && credentials.pool.held(connection, serving);
    return {
      description: [`계정 ${connection.accounts.length}개`, ...(serving && held ? [`지금 ${accountName(serving)}`] : []), starred].join(' · '),
      detail: held && <LeftGauge result={held} />,
    };
  }

  const adding = (
    <Button variant="secondary" icon={ACTS.create.icon} onClick={() => navigate({ kind: 'add-connection' })}>
      {newOf('연결')}
    </Button>
  );
  return (
    <Screen width="page" top={<NavBar title={PAGES.connections} {...backBar(back)} actions={adding} />}>
      {unreadable > 0 && <Callout tone="warn">암호화 키로 열리지 않는 항목 {unreadable}개는 목록에서 제외했어요.</Callout>}
      {search.field && <Row kind="toolbar">{search.field}</Row>}
      {search.none ? (
        <Empty variant="section">{search.none}</Empty>
      ) : connections.length > 0 ? (
        <Columns min="wide">
          {search.found.map((connection) => (
            <ItemCard
              key={connection.id}
              title={connection.value.label}
              {...card(connection.value)}
              tags={resolveConnection(connection.value) ? [] : ['지원하지 않는 연결']}
              current={route.kind === 'connection' && route.id === connection.id}
              onClick={() => navigate({ kind: 'connection', id: connection.id })}
            />
          ))}
        </Columns>
      ) : (
        <Empty variant="section" action={adding}>
          연결한 제공자가 없어요.
        </Empty>
      )}
    </Screen>
  );
}
