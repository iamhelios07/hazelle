import { Check, ChevronRight, MessageSquarePlus, Plus } from 'lucide-react';
import { useState } from 'react';
import { fitsRole, resolveRole, type ModelRef } from '../../connectors/assignment';
import { resolveConnection } from '../../connectors/registry';
import { SETTINGS_ID, type Settings } from '../../runtime/docs';
import { navigate, usePath } from '../router';
import { useConnections, useSettings, useStore, useUnreadable } from '../store';
import { Button, Callout, Icon, List, ListItem, NavBar, Screen, Section, Text } from '../ui';
import { describeFailure } from './failure';

export function ConnectionsScreen() {
  const store = useStore();
  const connections = useConnections();
  const settings = useSettings();
  const unreadable = useUnreadable();
  const path = usePath();
  const [message, setMessage] = useState<string | null>(null);

  const main = resolveRole('main', [settings.models]);
  const choices = connections.flatMap((connection) =>
    connection.value.starred.filter((model) => fitsRole(model, 'main')).map((model) => ({ connection, model })),
  );
  const mainChoice = main && choices.find(({ connection, model }) => connection.id === main.connection && model.id === main.model);

  async function choose(ref: ModelRef) {
    setMessage(null);
    const result = await store.save<Settings>('settings', SETTINGS_ID, (current) => ({ ...current, models: { ...current?.models, main: ref } }));
    if (!result.ok) setMessage(describeFailure(result));
  }

  return (
    <Screen
      top={<NavBar title="연결" onBack={() => navigate('/')} backLabel="홈으로" />}
      actions={
        <Button variant="secondary" icon={MessageSquarePlus} disabled={!mainChoice} onClick={() => navigate('/chats/new')}>
          새 채팅에서 써 보기
        </Button>
      }
    >
      {unreadable > 0 && <Callout tone="warn">금고 열쇠로 열리지 않는 항목이 {unreadable}개 있어요. 목록에서 빠져 있어요.</Callout>}
      <Section title="연결한 곳">
        {connections.length > 0 && (
          <List label="연결">
            {connections.map((connection) => (
              <ListItem
                key={connection.id}
                title={connection.value.label}
                description={connection.value.starred.length ? `별표 ${connection.value.starred.length}개` : '별표 없음'}
                tags={resolveConnection(connection.value) ? [] : ['이 버전이 모르는 연결']}
                trailing={<Icon icon={ChevronRight} />}
                current={path === `/connections/${connection.id}`}
                onClick={() => navigate(`/connections/${connection.id}`)}
              />
            ))}
          </List>
        )}
        <Button variant="secondary" size="md" icon={Plus} onClick={() => navigate('/connections/new')}>
          연결 추가
        </Button>
      </Section>
      <Section title="기본 모델 · 본 대화">
        {choices.length === 0 ? (
          <Text size="sm" tone="muted">
            연결에서 모델에 별표를 찍으면 여기서 고를 수 있어요.
          </Text>
        ) : (
          <List label="본 대화 모델">
            {choices.map(({ connection, model }) => {
              const selected = connection.id === main?.connection && model.id === main.model;
              return (
                <ListItem
                  key={`${connection.id}/${model.id}`}
                  title={model.name}
                  tags={[connection.value.label]}
                  selected={selected}
                  trailing={selected && <Icon icon={Check} />}
                  onClick={() => void choose({ connection: connection.id, model: model.id })}
                />
              );
            })}
          </List>
        )}
        {main && !mainChoice && <Callout tone="warn">본 대화로 정했던 모델이 별표 목록에 없어요. 다시 골라 주세요.</Callout>}
      </Section>
      {message && (
        <Callout tone="warn" alert>
          {message}
        </Callout>
      )}
    </Screen>
  );
}
