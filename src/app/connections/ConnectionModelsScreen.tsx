import { Star } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { RETRY_MOST } from '../../contracts/streams';
import { modelSettings, resolveConnection, RETRIES } from '../../connectors/registry';
import type { Model } from '../../connectors/types';
import type { Stored } from '../../model/kinds';
import { catalogKey, type CatalogResult } from '../../runtime/catalog';
import { refreshStarred, removeConnection, restoreConnection, setRetries, setStarred } from '../../runtime/connections';
import { modelProfile } from '../../runtime/profiles';
import { ACTS } from '../common/acts';
import { describeCatalogFailure } from '../common/failure';
import { useSearch } from '../common/useSearch';
import { RETRY_COUNT } from '../common/words';
import { useSession } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Callout, ChoiceGroup, Columns, Empty, IconButton, ItemSection, List, ListItem, MenuItem, NavBar, Panel, Row, Screen, SettingRow, Stack, Stepper, Text, useSplit } from '../ui';
import { ConnectionAccounts } from './ConnectionAccounts';
import { ConnectionMeters } from './ConnectionMeters';
import { ConnectionSent } from './ConnectionSent';

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
  const [filter, setFilter] = useState<Filter>('all');
  // From this width Page stacks a connection under API 연결's cards (ListDetail stack), so it is a part of that page.
  const stacked = useSplit();

  const key = catalogKey(connection);
  useEffect(() => {
    let current = true;
    setCatalog(null);
    void catalogs.load(connection, { fresh: attempt > 0 }).then((result) => {
      if (result.ok) void refreshStarred(store, id, result.models);
      if (current) setCatalog(result);
    });
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
    { value: 'starred' as const, label: '즐겨찾기' },
    ...(known ? (Object.entries(FILTERS) as [Filter, { label: string }][]).map(([value, { label }]) => ({ value, label })) : []),
  ];
  const search = useSearch(models, '모델 검색', (model) => [model.name, model.id]);
  const shown = search.found.filter((model) => filter === 'all' || (filter === 'starred' ? starredIds.has(model.id) : FILTERS[filter].test(model)));
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
        tags={!listed ? ['목록에 없음'] : model.protocol === 'unsupported' ? ['지원 안 됨', ...tags(model)] : tags(model)}
        trailing={
          <Row kind="actions">
            {settings}
            <IconButton icon={Star} label={on ? `${model.name} 즐겨찾기 해제` : `${model.name} 즐겨찾기`} pressed={on} onClick={() => toggle(model)} />
          </Row>
        }
      />
    );
  }

  function remove() {
    void removeConnection(store, id).then((result) => result.ok || toast.failed(result));
    navigate({ kind: 'connections' });
    toast.undoable(`'${connection.label}' 연결을 삭제했어요.`, () => restoreConnection(store, stored));
  }

  const signIn = resolveConnection(connection)?.type?.signIn;
  // Accounts join a pool by signing in, so a pool type always has a sign-in.
  const pool = connection.turns && signIn ? { connection: { ...connection, turns: connection.turns }, signIn } : null;

  const who = connection.turns ? `계정 ${connection.accounts.length}개` : connection.accounts[0]!.name;
  const listed = !catalog ? '모델 목록을 불러오는 중…' : catalog.ok ? `모델 ${catalog.models.length}개` : '모델 목록을 불러오지 못했어요';
  const menu = { of: '연결', items: <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={remove} /> };
  const level = stacked ? 3 : 2;

  const body = (
    <Columns min="panel">
      <Stack gap="group">
        {pool ? <ConnectionAccounts id={id} connection={pool.connection} signIn={pool.signIn} level={level} /> : <ConnectionMeters connection={connection} level={level} />}
        <Panel>
          <SettingRow
            label={RETRY_COUNT}
            help="응답이 오기 전에 실패하면 이 횟수만큼 다시 보내요. 키나 요청이 잘못됐을 때는 바로 알려요."
            control={
              <Stepper
                label={RETRY_COUNT}
                less="한 번 덜 보내기"
                more="한 번 더 보내기"
                value={connection.retries ?? RETRIES}
                min={0}
                max={RETRY_MOST}
                onChange={(retries) => void setRetries(store, id, retries).then((result) => result.ok || toast.failed(result))}
              />
            }
          />
        </Panel>
        <ConnectionSent connection={id} level={level} />
      </Stack>
      <Panel title="모델" level={level}>
        <Text variant="note">{[listed, starred.length ? `즐겨찾기 ${starred.length}개` : ''].filter(Boolean).join(' · ')}</Text>
        <Row kind="toolbar">
          {search.field}
          <ChoiceGroup label="모델 필터" options={filters} value={filter} onChange={setFilter} />
        </Row>
        {catalog && !catalog.ok && (
          <Callout tone="warn" action={{ label: ACTS.retry.label, onClick: () => setAttempt((count) => count + 1) }}>
            {describeCatalogFailure(catalog.failure)}
          </Callout>
        )}
        {shown.length > 0 ? (
          <Stack gap="group">
            {starredShown.length > 0 && <List label="즐겨찾기한 모델" keys={starredShown.map((model) => model.id)}>{(index) => row(starredShown[index]!)}</List>}
            {restShown.length > 0 && <List label="모델" keys={restShown.map((model) => model.id)}>{(index) => row(restShown[index]!)}</List>}
          </Stack>
        ) : (
          catalog?.ok && <Empty variant="section">{search.none ?? (filter !== 'all' ? '맞는 모델이 없어요.' : '모델이 없어요.')}</Empty>
        )}
      </Panel>
    </Columns>
  );

  return stacked ? (
    <Screen width="page">
      <ItemSection title={connection.label} note={who} menu={menu}>
        {body}
      </ItemSection>
    </Screen>
  ) : (
    <Screen width="page" top={<NavBar title={connection.label} subtitle={who} {...backBar(back)} menu={menu} />}>
      {body}
    </Screen>
  );
}
