import { Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { modelSettings } from '../../connectors/registry';
import type { Model } from '../../connectors/types';
import type { Stored } from '../../model/kinds';
import type { CatalogResult } from '../../runtime/catalog';
import { removeConnection, restoreConnection, setStarred } from '../../runtime/connections';
import { reportsMeters } from '../../runtime/meters';
import { modelProfile } from '../../runtime/profiles';
import { describeCatalogFailure, describeFailure } from '../common/failure';
import { useSession } from '../session';
import { navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Callout, ChoiceGroup, Empty, IconButton, List, ListItem, NavBar, Row, Screen, SearchField, Stack, Text } from '../ui';
import { ConnectionMeters } from './ConnectionMeters';

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

export function ConnectionModelsScreen({ stored, back }: { stored: Stored<'connection'>; back: Back }) {
  const { store, catalogs } = useSession();
  const toast = useToast();
  const { id, value: connection } = stored;
  const [catalog, setCatalog] = useState<CatalogResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [message, setMessage] = useState<string | null>(null);
  // Stars show at once; the saves behind them run one after another, and a failed one puts the stored list back.
  const [pendingStars, setPendingStars] = useState<Model[] | null>(null);
  const saving = useRef({ queue: Promise.resolve(), count: 0 });

  const catalogKey = JSON.stringify([connection.type, connection.baseUrl, connection.protocol, connection.secret]);
  useEffect(() => {
    let current = true;
    setCatalog(null);
    void catalogs.load(connection, { fresh: attempt > 0 }).then((result) => current && setCatalog(result));
    return () => {
      current = false;
    };
    // The stored object is replaced on every sync; only a change to its endpoint or key means a new list.
  }, [catalogKey, attempt]);

  const starred = pendingStars ?? connection.starred;
  const models = useMemo(() => {
    const listed = catalog?.ok ? catalog.models : [];
    // A starred model the provider no longer lists stays visible, so it can be unstarred.
    const missing = starred.filter((model) => !listed.some((entry) => entry.id === model.id));
    return [...missing, ...listed];
  }, [catalog, starred]);

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
    setPendingStars(on ? starred.filter((entry) => entry.id !== model.id) : [...starred, model]);
    setMessage(null);
    const state = saving.current;
    state.count++;
    state.queue = state.queue.then(async () => {
      const result = store.get('connection', id) ? await setStarred(store, id, model, !on) : null;
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
    const result = await removeConnection(store, id);
    if (!result.ok) {
      setMessage(describeFailure(result));
      return;
    }
    navigate({ kind: 'connections' });
    toast.undoable(`${result.data.value.label} 연결을 지웠어요.`, () => void restoreConnection(store, result.data));
  }

  const subtitle = !catalog ? '모델 목록을 불러오는 중…' : catalog.ok ? `모델 ${catalog.models.length}개` : '모델 목록을 불러오지 못했어요';

  return (
    <Screen
      top={
        <NavBar
          title={connection.label}
          subtitle={subtitle}
          onBack={() => navigate(back.to)}
          backLabel={back.label}
          actions={<IconButton icon={Trash2} label="연결 지우기" onClick={() => void remove()} />}
        />
      }
      stickyActions
      actions={
        <Stack gap="related">
          <Text size="sm" tone="muted">
            별표 {starred.length}개 · 별표한 모델은 프롬프트와 기본값에서 고를 수 있어요
          </Text>
          <Button onClick={() => navigate({ kind: 'connections' })}>완료</Button>
        </Stack>
      }
    >
      {reportsMeters(connection) && <ConnectionMeters connection={connection} />}
      <Stack gap="related">
        <SearchField label="모델 검색" value={query} onChange={setQuery} />
        <ChoiceGroup label="모델 거르기" options={filters} value={filter} onChange={setFilter} />
      </Stack>
      {catalog && !catalog.ok && (
        <Callout tone="warn" action={{ label: '다시 불러오기', onClick: () => setAttempt((count) => count + 1) }}>
          {describeCatalogFailure(catalog.failure)}
        </Callout>
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
            // Only a star already saved has a 묶음 to open; one still saving has none yet.
            const saved = on ? connection.starred.find((entry) => entry.id === model.id) : undefined;
            const choice = saved && modelSettings(connection, saved) ? modelProfile(store, saved) : null;
            const opens = choice && (choice.kind === 'profile' ? `설정 · ${choice.profile.value.name}` : '설정 없음');
            const settings = choice && (
              <Button
                variant="ghost"
                size="sm"
                label={`${opens} · ${model.name}`}
                onClick={() => navigate(choice.kind === 'profile' ? { kind: 'profile', id: choice.profile.id } : { kind: 'profiles' })}
              >
                {opens}
              </Button>
            );
            return (
              <ListItem
                key={model.id}
                title={model.name}
                code={model.id}
                tags={!listed ? ['목록에 없음'] : model.protocol === 'unsupported' ? ['아직 못 씀', ...tags(model)] : tags(model)}
                trailing={
                  <Row kind="actions">
                    {settings}
                    <IconButton icon={Star} label={on ? `${model.name} 별표 빼기` : `${model.name} 별표 찍기`} pressed={on} onClick={() => toggle(model)} />
                  </Row>
                }
              />
            );
          })}
        </List>
      ) : (
        catalog?.ok && <Empty>{needle || filter !== 'all' ? '맞는 모델이 없어요.' : '이 연결은 모델을 하나도 알려 주지 않았어요.'}</Empty>
      )}
    </Screen>
  );
}
