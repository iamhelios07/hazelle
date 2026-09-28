import { ChevronRight, Plus } from 'lucide-react';
import { resolveConnection } from '../../connectors/registry';
import { useConnections, useUnreadable } from '../session';
import { backBar, navigate, useRoute } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Callout, Empty, Icon, List, ListItem, NavBar, Screen } from '../ui';

// The default model is chosen in 설정's 기본값 (settings/DefaultsScreen), not here.
export function ConnectionsScreen({ back }: { back: Back | null }) {
  const connections = useConnections();
  const unreadable = useUnreadable();
  const route = useRoute();

  return (
    <Screen
      top={
        <NavBar
          title="연결"
          {...backBar(back)}
          actions={
            <Button variant="secondary" size="sm" icon={Plus} onClick={() => navigate({ kind: 'add-connection' })}>
              연결 추가
            </Button>
          }
        />
      }
    >
      {unreadable > 0 && <Callout tone="warn">금고 열쇠로 열리지 않는 항목이 {unreadable}개 있어요. 목록에서 빠져 있어요.</Callout>}
      {connections.length > 0 ? (
        <List label="연결">
          {connections.map((connection) => (
            <ListItem
              key={connection.id}
              title={connection.value.label}
              description={connection.value.starred.length ? `별표 ${connection.value.starred.length}개` : '별표 없음'}
              tags={resolveConnection(connection.value) ? [] : ['이 버전이 모르는 연결']}
              trailing={<Icon icon={ChevronRight} />}
              current={(route.kind === 'connection' && route.id === connection.id) || (route.kind === 'model-settings' && route.connection === connection.id)}
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
