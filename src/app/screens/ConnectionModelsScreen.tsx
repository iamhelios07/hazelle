import { Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Connection, Model } from '../../connectors/types';
import { loadCatalog, type CatalogResult } from '../../runtime/catalog';
import { navigate } from '../router';
import { useConnection, useStore } from '../store';
import { useToast } from '../toast';
import { Button, Callout, ChoiceGroup, IconButton, List, ListItem, NavBar, Screen, SearchField, Stack, Text } from '../ui';
import { describeCatalogFailure, describeFailure } from './failure';

type Filter = 'all' | 'starred' | 'reasoning' | 'vision' | 'tools';

const FILTERS: Record<Exclude<Filter, 'all' | 'starred'>, { label: string; test: (model: Model) => boolean }> = {
  reasoning: { label: '추론', test: (model) => model.reasoning === true },
  vision: { label: '비전', test: (model) => model.input?.includes('image') === true },
  tools: { label: '도구', test: (model) => model.tools === true },
};

// Only what the catalog says a model can do. An unknown capability gets no tag.
function tags(model: Model): string[] {
  return Object.values(FILTERS)
    .filter((filter) => filter.test(model))
    .map((filter) => filter.label);
}

export function ConnectionModelsScreen({ id }: { id: string }) {
  const store = useStore();
  const toast = useToast();
  const stored = useConnection(id);
  const [catalog, setCatalog] = useState<CatalogResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [message, setMessage] = useState<string | null>(null);
  // Stars show at once; the saves behind them run one after another, and a failed one puts the stored list back.
  const [pendingStars, setPendingStars] = useState<Model[] | null>(null);
  const saving = useRef({ queue: Promise.resolve(), count: 0 });

  const connection = stored?.value;
  const catalogKey = connection && JSON.stringify([connection.type, connection.baseUrl, connection.protocol, connection.secret]);
  useEffect(() => {
    if (!connection) return;
    let current = true;
    setCatalog(null);
    void loadCatalog(connection, { fresh: attempt > 0 }).then((result) => current && setCatalog(result));
    return () => {
      current = false;
    };
    // The stored object is replaced on every sync; only a change to its endpoint or key means a new list.
  }, [catalogKey, attempt]);

  const starred = pendingStars ?? connection?.starred ?? [];
  const models = useMemo(() => {
    const listed = catalog?.ok ? catalog.models : [];
    // A starred model the provider no longer lists stays visible, so it can be unstarred.
    const missing = starred.filter((model) => !listed.some((entry) => entry.id === model.id));
    return [...missing, ...listed];
  }, [catalog, starred]);

  if (!stored || !connection) {
    return (
      <Screen top={<NavBar title="연결" onBack={() => navigate('/connections')} />}>
        <Text tone="muted">이 연결을 찾을 수 없어요. 지워졌을 수 있어요.</Text>
      </Screen>
    );
  }

  const known = models.some((model) => tags(model).length > 0);
  const filters = [
    { value: 'all' as const, label: '전체' },
    { value: 'starred' as const, label: '별표' },
    ...(known ? (Object.entries(FILTERS) as [Filter, { label: string }][]).map(([value, { label }]) => ({ value, label })) : []),
  ];
  const needle = query.trim().toLowerCase();
  const shown = models.filter(
    (model) =>
      (filter === 'all' ||
        (filter === 'starred' ? starred.some((entry) => entry.id === model.id) : FILTERS[filter].test(model))) &&
      (!needle || model.name.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle)),
  );

  function toggle(model: Model) {
    const on = starred.some((entry) => entry.id === model.id);
    const without = (list: Model[]) => list.filter((entry) => entry.id !== model.id);
    setPendingStars(on ? without(starred) : [...starred, model]);
    setMessage(null);
    const state = saving.current;
    state.count++;
    state.queue = state.queue.then(async () => {
      const result = store.get<Connection>(id)
        ? await store.save<Connection>('connection', id, (current) => ({ ...current!, starred: on ? without(current!.starred) : [...without(current!.starred), model] }))
        : null;
      state.count--;
      if (result && !result.ok) {
        setMessage(describeFailure(result));
        setPendingStars(null);
      } else if (state.count === 0) {
        setPendingStars(null);
      }
    });
  }

  async function remove() {
    const value = connection!;
    const result = await store.remove(id);
    if (!result.ok) {
      setMessage(describeFailure(result));
      return;
    }
    navigate('/connections');
    toast({
      message: `${value.label} 연결을 지웠어요.`,
      action: { label: '되돌리기', onClick: () => void store.save<Connection>('connection', id, () => value) },
    });
  }

  const subtitle = !catalog ? '모델 목록을 불러오는 중…' : catalog.ok ? `모델 ${catalog.models.length}개` : '모델 목록을 불러오지 못했어요';

  return (
    <Screen
      top={
        <NavBar
          title={connection.label}
          subtitle={subtitle}
          onBack={() => navigate('/connections')}
          actions={<IconButton icon={Trash2} label="연결 지우기" onClick={() => void remove()} />}
        />
      }
      stickyActions
      actions={
        <Stack gap={12}>
          <Text size="sm" tone="muted">
            별표 {starred.length}개 · 기본 모델로 고를 수 있어요
          </Text>
          <Button onClick={() => navigate('/connections')}>완료</Button>
        </Stack>
      }
    >
      <Stack gap={12}>
        <SearchField label="모델 검색" value={query} onChange={setQuery} />
        <ChoiceGroup label="모델 거르기" options={filters} value={filter} onChange={setFilter} />
      </Stack>
      {catalog && !catalog.ok && (
        <Stack gap={12}>
          <Callout tone="warn">{describeCatalogFailure(catalog.failure)}</Callout>
          <Button variant="secondary" size="md" onClick={() => setAttempt((count) => count + 1)}>
            다시 불러오기
          </Button>
        </Stack>
      )}
      {message && (
        <Callout tone="warn" alert>
          {message}
        </Callout>
      )}
      {shown.length > 0 ? (
        <List label="모델">
          {shown.map((model) => {
            const on = starred.some((entry) => entry.id === model.id);
            const listed = !catalog?.ok || catalog.models.some((entry) => entry.id === model.id);
            return (
              <ListItem
                key={model.id}
                title={model.name}
                code={model.id}
                tags={listed ? tags(model) : ['목록에 없음']}
                trailing={<IconButton icon={Star} label={on ? `${model.name} 별표 빼기` : `${model.name} 별표 찍기`} pressed={on} onClick={() => toggle(model)} />}
              />
            );
          })}
        </List>
      ) : (
        catalog?.ok && <Text tone="muted">{needle || filter !== 'all' ? '맞는 모델이 없어요.' : '이 연결은 모델을 하나도 알려 주지 않았어요.'}</Text>
      )}
    </Screen>
  );
}
