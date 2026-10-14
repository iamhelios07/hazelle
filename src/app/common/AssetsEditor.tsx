import { unsupportedCount } from '../../engine/import/types';
import { ImageUp, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { findAsset } from '../../engine/assets';
import type { Stored } from '../../model/kinds';
import { addAssets, removeAssets, renameAsset, replaceAsset, restoreAssets } from '../../runtime/characters';
import { useAssetUrl, useChildren, useFiles, useStore, useUnfoundAssets } from '../session';
import { useToast } from '../toast';
import { Button, Callout, CardGrid, Dialog, DropOverlay, Empty, FaceCard, FileButton, MenuItem, MoreMenu, pickFiles, Preview, Row, Section, SelectionBar, Stack, useFileDrop } from '../ui';
import { ACTS, addOf } from './acts';
import { NameDialog } from './NameDialog';
import { useCopy } from './useCopy';
import { useSearch } from './useSearch';
import { CHANGE_IMAGE } from './words';

const ASSET = '에셋';
// By name, never by the store's order, which moves an asset to the end on each rename or new picture.
const byName = new Intl.Collator('ko', { numeric: true }).compare;
const UNFOUND_SHOWN = 10;

export function AssetsEditor({ owner }: { owner: string }) {
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const stored = useChildren('asset', owner);
  const assets = useMemo(() => stored.toSorted((a, b) => byName(a.value.name, b.value.name)), [stored]);
  const [adding, setAdding] = useState(false);
  const [naming, setNaming] = useState<Stored<'asset'> | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  // null while not picking.
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const copy = useCopy();
  // A module is never a key: a chat's names are told under its character, whichever pack's text asked for them. A name
  // the assets answer now, a near one included, is no longer missing.
  const asked = useUnfoundAssets(owner);
  const unfound = useMemo(() => {
    const named = assets.map(({ id, value }) => ({ id, name: value.name }));
    return [...asked].filter((name) => !findAsset(named, name, Math.random));
  }, [asked, assets]);
  const search = useSearch(assets, `${ASSET} 검색`, ({ value }) => [value.name]);
  const named = (asset: Stored<'asset'>) => asset.value.name.toLowerCase();
  const shared = new Map<string, number>();
  for (const asset of assets) shared.set(named(asset), (shared.get(named(asset)) ?? 0) + 1);

  async function add(picked: File[]) {
    if (!picked.length) return;
    setAdding(true);
    const added = await addAssets(store, files, owner, picked);
    setAdding(false);
    if (!added.ok) return toast.failed(added, `${ASSET}을 추가하지 못했어요.`);
    const refused = unsupportedCount(added.data.unsupported);
    if (refused) toast.error(`${refused}개는 추가하지 못했어요.`, { detail: '이미지가 아니거나 너무 커요.' });
  }

  const dragging = useFileDrop((dropped) => void add(dropped), 'screen');

  async function remove(ids: readonly string[]) {
    const removed = await removeAssets(store, ids);
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    const [only] = removed.data;
    toast.undoable(removed.data.length === 1 ? `'${only!.value.name}' ${ASSET}을 삭제했어요.` : `${ASSET} ${removed.data.length}개를 삭제했어요.`, () => restoreAssets(store, removed.data));
  }

  async function replace(id: string, file: File) {
    const replaced = await replaceAsset(store, files, id, new Uint8Array(await file.arrayBuffer()));
    if (!replaced.ok) toast.failed(replaced, '이미지를 바꾸지 못했어요.');
  }

  function rename(name: string) {
    const trimmed = name.trim();
    if (!naming || !trimmed) return;
    setNaming(null);
    void renameAsset(store, naming.id, trimmed).then((saved) => saved.ok || toast.failed(saved, '저장하지 못했어요.'));
  }

  // One list for a card's ⋯ and its preview's buttons.
  const actionsOf = (asset: Stored<'asset'>): Action[] => [
    { icon: ACTS.copy.icon, label: `태그 ${ACTS.copy.label}`, run: () => copy(`{{img::${asset.value.name}}}`) },
    { icon: ACTS.rename.icon, label: ACTS.rename.label, run: () => setNaming(asset) },
    { icon: ImageUp, label: CHANGE_IMAGE, run: () => pickFiles('image/*', false, ([file]) => void replace(asset.id, file!)) },
    { icon: ACTS.remove.icon, label: ACTS.remove.label, warn: true, run: () => { setViewing(null); void remove([asset.id]); } },
  ];

  function press(id: string) {
    if (!picked) return setViewing(id);
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  const viewed = viewing === null ? undefined : assets.find(({ id }) => id === viewing);
  return (
    <Section title={ASSET} note={`${assets.length}개`} help="봇이 {{img::이름}}처럼 이름으로 불러 보여 주는 이미지예요. 이름이 같은 에셋이 여럿이면 그중 하나가 무작위로 나와요. 파일이나 폴더를 끌어다 놓아도 추가돼요. 없는 이름 경고는 앱을 연 뒤 이 기기에서 본 채팅 기준이에요.">
      <Stack gap="related">
        {unfound.length > 0 && (
          <Callout tone="warn">
            {`채팅에서 봇이 불렀지만 없는 이름이 ${unfound.length}개 있어요: ${unfound.slice(0, UNFOUND_SHOWN).join(', ')}${unfound.length > UNFOUND_SHOWN ? ` 외 ${unfound.length - UNFOUND_SHOWN}개` : ''}`}
          </Callout>
        )}
        <Row kind="toolbar">
          {search.field}
          {assets.length > 0 && (
            <Button variant="secondary" size="sm" icon={ACTS.remove.icon} onClick={() => setPicked(picked ? null : new Set())}>
              {picked ? '완료' : '선택해서 삭제'}
            </Button>
          )}
          <FileButton accept="image/*" multiple size="sm" icon={ACTS.create.icon} busy={adding} onFiles={(dropped) => void add(dropped)}>
            {addOf(ASSET)}
          </FileButton>
        </Row>
        {search.found.length > 0 ? (
          <CardGrid label={ASSET} variant="face" keys={search.found.map(({ id }) => id)}>
            {(index) => {
              const asset = search.found[index]!;
              return <AssetCard key={asset.id} asset={asset} shared={shared.get(named(asset))!} picked={picked && picked.has(asset.id)} onPress={() => press(asset.id)} actions={actionsOf(asset)} />;
            }}
          </CardGrid>
        ) : (
          <Empty variant="section">{search.none ?? `${ASSET}이 없어요.`}</Empty>
        )}
        {picked && (
          <SelectionBar>
            <span>{picked.size ? `${picked.size}개 선택됨` : '삭제할 에셋을 선택하세요'}</span>
            <Button variant="secondary" size="sm" onClick={() => setPicked(new Set(search.found.map(({ id }) => id)))}>
              모두 선택
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setPicked(null)}>
              취소
            </Button>
            <Button variant="danger" size="sm" disabled={picked.size === 0} onClick={() => { setPicked(null); void remove([...picked]); }}>
              {ACTS.remove.label}
            </Button>
          </SelectionBar>
        )}
      </Stack>
      {dragging && <DropOverlay>여기에 놓으면 에셋으로 추가해요</DropOverlay>}
      {viewed && <AssetPreview asset={viewed} actions={actionsOf(viewed)} onClose={() => setViewing(null)} />}
      {naming && <NameDialog title={`${ASSET} ${ACTS.rename.label}`} value={naming.value.name} hint="봇은 이 이름으로 이미지를 불러요." onSave={rename} onClose={() => setNaming(null)} />}
    </Section>
  );
}

type Action = { icon: LucideIcon; label: string; warn?: boolean; run: () => void };
const kindOf = ({ value }: Stored<'asset'>) => value.type.replace('image/', '').toUpperCase();

type CardProps = { asset: Stored<'asset'>; shared: number; picked: boolean | null; onPress: () => void; actions: Action[] };

// Each card holds its own picture while drawn, so a grid of thousands keeps only the rows on screen.
function AssetCard({ asset, shared, picked, onPress, actions }: CardProps) {
  const url = useAssetUrl();
  const { id, value } = asset;
  return (
    <FaceCard
      image={url('asset', id) ?? null}
      name={value.name}
      note={shared > 1 ? `같은 이름 ${shared}개` : kindOf(asset)}
      selected={picked}
      onClick={onPress}
      popup={picked === null ? 'dialog' : undefined}
      menu={
        picked === null && (
          <MoreMenu of={`'${value.name}'`}>
            {actions.map(({ icon, label, warn, run }) => (
              <MenuItem key={label} icon={icon} label={label} tone={warn ? 'warn' : undefined} onClick={run} />
            ))}
          </MoreMenu>
        )
      }
    />
  );
}

// Its own view, so the whole picture is held only while it is open.
function AssetPreview({ asset, actions, onClose }: { asset: Stored<'asset'>; actions: Action[]; onClose: () => void }) {
  const url = useAssetUrl();
  return (
    <Dialog
      title={asset.value.name}
      note={kindOf(asset)}
      size="wide"
      onClose={onClose}
      actions={actions.map(({ icon, label, warn, run }) => (
        <Button key={label} variant={warn ? 'danger' : 'secondary'} icon={icon} onClick={run}>
          {label}
        </Button>
      ))}
    >
      <Preview image={url('asset', asset.id) ?? null} name={asset.value.name} />
    </Dialog>
  );
}
