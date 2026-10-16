import { useState } from 'react';
import { resolveConnection, searchTypes } from '../../connectors/registry';
import type { ConnectionType } from '../../connectors/types';
import { providerConnection } from '../../runtime/connections';
import { newOf } from '../common/acts';
import { noResults } from '../common/search';
import { useAttempt } from '../common/useAttempt';
import { useConnections, useSession } from '../session';
import { backBar, navigate, useRoute } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Callout, Empty, List, ListItem, NavBar, Screen, SearchField, Section, Stack, Text } from '../ui';
import { connect } from './connect';

const GROUPS: Record<ConnectionType['group'], string> = {
  gateway: '여러 회사 모델을 한 키로',
  maker: '제작사 API로',
  subscription: '구독 계정으로',
};

export function ConnectionAddScreen({ back }: { back: Back }) {
  const session = useSession();
  const connections = useConnections();
  const route = useRoute();
  const [query, setQuery] = useState('');
  const { busy, failure, run } = useAttempt();

  const search = searchTypes(query);
  const shown = search.kind === 'types' ? search.types : search.kind === 'key' ? [search.type] : [];
  const connected = (type: ConnectionType) => connections.filter((entry) => resolveConnection(entry.value)?.type === type).length;
  const connectKey = (type: ConnectionType, secret: string) => run((signal) => connect(session, providerConnection(type, secret), signal));
  // A major type stays in its group too, so it is found in either place. A narrowed list has no 주요.
  const sections: [string, readonly ConnectionType[]][] = [
    ['주요', query.trim() ? [] : shown.filter((type) => type.major)],
    ...(Object.keys(GROUPS) as ConnectionType['group'][]).map((group): [string, readonly ConnectionType[]] => [GROUPS[group], shown.filter((type) => type.group === group)]),
  ];

  return (
    <Screen top={<NavBar title={newOf('연결')} {...backBar(back)} />}>
      <SearchField label="이름 검색, 또는 키·주소 붙여 넣기" value={query} onChange={setQuery} />
      {search.kind === 'key' && (
        <Stack gap="related">
          <Callout tone="success">{search.type.label} 키예요.</Callout>
          <Button busy={busy} onClick={() => void connectKey(search.type, search.secret)}>
            이 키로 연결하고 모델 선택
          </Button>
        </Stack>
      )}
      {search.kind === 'address' && <Text variant="note">목록에 없는 주소는 아래의 직접 연결로 추가해요.</Text>}
      {search.kind === 'none' && <Empty>{noResults(query.trim())}</Empty>}
      {failure && (
        <Callout tone="warn" alert>
          {failure}
        </Callout>
      )}
      {sections.map(([title, types]) =>
        types.length ? (
          <Section key={title} title={title}>
            <List label={title} places>
              {types.map((type) => {
                const count = connected(type);
                return (
                  <ListItem
                    key={type.id}
                    title={type.label}
                    description={type.description}
                    tags={[type.signIn ? `${type.signIn.site} 로그인` : (type.keyForm?.label ?? 'API 키'), ...(count ? [`연결 ${count}개`] : [])]}
                    current={route.kind === 'connect' && route.type === type}
                    onClick={() => navigate({ kind: 'connect', type })}
                  />
                );
              })}
            </List>
          </Section>
        ) : null,
      )}
      <Section title="목록에 없는 제공자">
        <List label="직접 연결" places>
          <ListItem
            title="직접 연결"
            description="OpenAI 호환, OpenAI Responses, Anthropic 호환 주소와 키로 연결해요. 잔액과 비용은 확인할 수 없어요."
            current={route.kind === 'connect-direct'}
            onClick={() => navigate({ kind: 'connect-direct', address: search.kind === 'address' ? search.baseUrl : '' })}
          />
        </List>
      </Section>
    </Screen>
  );
}
