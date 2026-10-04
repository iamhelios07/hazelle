import { Star, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { modelSettings } from '../../connectors/registry';
import type { Model } from '../../connectors/types';
import type { Stored } from '../../model/kinds';
import { catalogKey, type CatalogResult } from '../../runtime/catalog';
import { removeConnection, restoreConnection, setStarred } from '../../runtime/connections';
import { reportsMeters } from '../../runtime/meters';
import { modelProfile } from '../../runtime/profiles';
import { describeCatalogFailure } from '../common/failure';
import { useSession } from '../session';
import { backBar, navigate } from '../shell/router';
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

  const key = catalogKey(connection);
  useEffect(() => {
    let current = true;
    setCatalog(null);
    void catalogs.load(connection, { fresh: attempt > 0 }).then((result) => current && setCatalog(result));
    return () => {
      current = false;
    };
    // The stored object is replaced on every sync; only a change to its endpoint or key means a new list.
  }, [key, attempt]);

  const starred = connection.starred;
  const starredIds = useMemo(() => new Set(starred.map((model) => model.id)), [starred]);
  const listedIds = useMemo(() => (catalog?.ok ? new Set(catalog.models.map((model) => model.id)) : null), [catalog]);
  const models = useMemo(() => {
    // A starred model the provider no longer lists stays visible, so it can be unstarred.
    const missing = starred.filter((model) => !listedIds?.has(model.id));
    return [...missing, ...(catalog?.ok ? catalog.models : [])];
  }, [catalog, listedIds, starred]);

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
        (filter === 'starred' ? starredIds.has(model.id) : FILTERS[filter].test(model))) &&
      (!needle || model.name.toLowerCase().includes(needle) || model.id.toLowerCase().includes(needle)),
  );
  const starredShown = shown.filter((model) => starredIds.has(model.id));
  const restShown = shown.filter((model) => !starredIds.has(model.id));

  function toggle(model: Model) {
    void setStarred(store, id, model, !starredIds.has(model.id)).then((result) => result.ok || toast.failed(result));
  }

  function row(model: Model) {
    const on = starredIds.has(model.id);
    const listed = !listedIds || listedIds.has(model.id);
    const saved = on ? connection.starred.find((entry) => entry.id === model.id) : undefined;
    const choice = saved && modelSettings(connection, saved) ? modelProfile(store, saved) : null;
    const opens = choice && (choice.kind === 'profile' ? `설정 · ${choice.profile.value.name}` : '설정 없음');
    const settings = choice && (
      <Button
        variant="ghost"
        size="sm"
        label={`${opens} · ${model.name}`}
        onClick={() => navigate({ kind: 'model', connection: id, model: model.id })}
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
            <IconButton icon={Star} label={on ? `${model.name} 별표 빼기` : `${model.name} 별표하기`} pressed={on} onClick={() => toggle(model)} />
          </Row>
        }
      />
    );
  }

  function remove() {
    void removeConnection(store, id).then((result) => result.ok || toast.failed(result));
    navigate({ kind: 'connections' });
    toast.undoable(`${connection.label} 연결을 지웠어요.`, () => void restoreConnection(store, stored));
  }

  const subtitle = !catalog ? '모델 목록을 불러오는 중…' : catalog.ok ? `모델 ${catalog.models.length}개` : '모델 목록을 불러오지 못했어요';

  return (
    <Screen
      top={
        <NavBar
          title={connection.label}
          subtitle={connection.account ? `${connection.account} · ${subtitle}` : subtitle}
          {...backBar(back)}
          actions={<IconButton icon={Trash2} label="연결 지우기" onClick={remove} />}
        />
      }
      stickyActions
      actions={
        <Stack gap="related">
          <Text variant="note">
            별표 {starred.length}개
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
      {shown.length > 0 ? (
        <Stack gap="group">
          {starredShown.length > 0 && <List label="별표한 모델">{starredShown.map(row)}</List>}
          {restShown.length > 0 && <List label="모델">{restShown.map(row)}</List>}
        </Stack>
      ) : (
        catalog?.ok && <Empty>{needle || filter !== 'all' ? '맞는 모델이 없어요.' : '이 연결은 모델을 하나도 알려 주지 않았어요.'}</Empty>
      )}
    </Screen>
  );
}
