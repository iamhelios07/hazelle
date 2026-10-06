import { ChevronRight, Plus } from 'lucide-react';
import { resolveConnection } from '../../connectors/registry';
import type { Connection } from '../../connectors/types';
import { accountName } from '../../runtime/pool';
import { useConnections, useSession, useUnreadable } from '../session';
import { leftOf } from './ConnectionMeters';
import { backBar, navigate, useRoute } from '../shell/router';
import type { Back } from '../shell/routes';
import { PAGES } from '../common/words';
import { Button, Callout, Empty, Icon, List, ListItem, NavBar, Screen } from '../ui';

// The default model is chosen on 설정's 모델 page, not here.
export function ConnectionsScreen({ back }: { back: Back | null }) {
  const connections = useConnections();
  const unreadable = useUnreadable();
  const route = useRoute();
  const { credentials } = useSession();

  // A pool names who would serve now and what it has left, from meters already read; nothing is fetched for the list.
  function summary(connection: Connection): string {
    const starred = connection.starred.length ? `별표 ${connection.starred.length}개` : '별표 없음';
    if (!connection.turns) return [connection.accounts[0]!.name, starred].filter(Boolean).join(' · ');
    const serving = credentials.pool.peek(connection);
    const held = serving && credentials.pool.held(connection, serving);
    const left = held && leftOf(held);
    return [`계정 ${connection.accounts.length}개`, ...(serving && left ? [`지금 ${accountName(serving)}`, left] : [starred])].join(' · ');
  }

  return (
    <Screen
      top={
        <NavBar
          title={PAGES.connections}
          {...backBar(back)}
          actions={
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => navigate({ kind: 'add-connection' })}>
              연결 추가
            </Button>
          }
        />
      }
    >
      {unreadable > 0 && <Callout tone="warn">불러온 항목 중 금고 열쇠로 열리지 않는 항목이 {unreadable}개 있어요. 목록에서 빠져 있어요.</Callout>}
      {connections.length > 0 ? (
        <List label="연결">
          {connections.map((connection) => (
            <ListItem
              key={connection.id}
              title={connection.value.label}
              description={summary(connection.value)}
              tags={resolveConnection(connection.value) ? [] : ['이 버전이 모르는 연결']}
              trailing={<Icon icon={ChevronRight} />}
              current={route.kind === 'connection' && route.id === connection.id}
              onClick={() => navigate({ kind: 'connection', id: connection.id })}
            />
          ))}
        </List>
      ) : (
        <Empty variant="section">아직 연결한 곳이 없어요. 연결 추가에서 쓰는 곳을 골라 보세요.</Empty>
      )}
    </Screen>
  );
}
