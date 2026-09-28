import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { resolveConnection, searchTypes } from '../../connectors/registry';
import type { ConnectionType } from '../../connectors/types';
import { useAttempt } from '../common/useAttempt';
import { useConnections, useSession } from '../session';
import { navigate, useRoute } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Callout, Icon, List, ListItem, NavBar, Screen, SearchField, Section, Stack, Text } from '../ui';
import { connect } from './connect';

const GROUPS: Record<ConnectionType['group'], string> = {
  gateway: '여러 회사 모델을 한 키로',
  maker: '만든 회사에 바로',
  subscription: '구독 계정으로',
};

// F5: pick a provider from the list, or paste its key or address into the one field on top. What the
// list does not hold goes through 직접 연결.
export function ConnectionAddScreen({ back }: { back: Back }) {
  const session = useSession();
  const connections = useConnections();
  const route = useRoute();
  const [query, setQuery] = useState('');
  const { busy, failure, run } = useAttempt();

  const search = searchTypes(query);
  const shown = search.kind === 'types' ? search.types : search.kind === 'key' ? [search.type] : [];
  const connected = (type: ConnectionType) => connections.filter((entry) => resolveConnection(entry.value)?.type === type).length;
  const connectKey = (type: ConnectionType, secret: string) => run(() => connect(session, { type: type.id, label: type.label, baseUrl: null, protocol: null, secret, starred: [] }));

  return (
    <Screen top={<NavBar title="연결 추가" onBack={() => navigate(back.to)} backLabel={back.label} />}>
      <SearchField label="이름 검색, 또는 키·주소 붙여 넣기" value={query} onChange={setQuery} />
      {search.kind === 'key' && (
        <Stack gap={12}>
          <Callout tone="success">{search.type.label} 키로 알아봤어요.</Callout>
          <Button busy={busy} onClick={() => void connectKey(search.type, search.secret)}>
            이 키로 연결하고 모델 고르기
          </Button>
        </Stack>
      )}
      {search.kind === 'address' && <Text tone="muted">목록에 없는 주소예요. 아래 직접 연결로 이어서 연결할 수 있어요.</Text>}
      {search.kind === 'none' && <Text tone="muted">목록에 맞는 곳이 없어요. 직접 연결로 연결할 수 있어요.</Text>}
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
      {(Object.keys(GROUPS) as ConnectionType['group'][]).map((group) => {
        const types = shown.filter((type) => type.group === group);
        if (!types.length) return null;
        return (
          <Section key={group} title={GROUPS[group]}>
            <List label={GROUPS[group]}>
              {types.map((type) => {
                const count = connected(type);
                return (
                  <ListItem
                    key={type.id}
                    title={type.label}
                    description={type.description}
                    tags={[type.signIn ? `${type.signIn.site} 로그인` : 'API 키', ...(count ? [`연결됨 ${count}`] : [])]}
                    trailing={<Icon icon={ChevronRight} />}
                    current={route.kind === 'connect' && route.type === type}
                    onClick={() => navigate({ kind: 'connect', type })}
                  />
                );
              })}
            </List>
          </Section>
        );
      })}
      <Section title="목록에 없는 곳">
        <List label="직접 연결">
          <ListItem
            title="직접 연결"
            description="OpenAI 호환이나 Anthropic 호환 주소와 키로 연결해요. 잔액과 비용은 알 수 없어요."
            trailing={<Icon icon={ChevronRight} />}
            current={route.kind === 'connect-direct'}
            onClick={() => navigate({ kind: 'connect-direct', address: search.kind === 'address' ? search.baseUrl : '' })}
          />
        </List>
      </Section>
    </Screen>
  );
}
