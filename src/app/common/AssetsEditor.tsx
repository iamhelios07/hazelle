import { ImageUp } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Stored } from '../../model/kinds';
import { addAssets, removeAsset, renameAsset, replaceAsset, restoreAsset } from '../../runtime/characters';
import { useAssetUrl, useChildren, useFiles, useStore } from '../session';
import { useToast } from '../toast';
import { CardGrid, DropOverlay, Empty, FaceCard, FileButton, MenuItem, MoreMenu, pickFiles, Row, Section, Stack, useFileDrop, useMenuHandle, useMenuOpener } from '../ui';
import { ACTS, addOf } from './acts';
import { NameDialog } from './NameDialog';
import { useCopy } from './useCopy';
import { useSearch } from './useSearch';
import { CHANGE_IMAGE } from './words';

const ASSET = '에셋';
// By name, never by the store's order, which moves an asset to the end on each rename or new picture.
const byName = new Intl.Collator('ko', { numeric: true }).compare;

export function AssetsEditor({ owner }: { owner: string }) {
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const stored = useChildren('asset', owner);
  const assets = useMemo(() => stored.toSorted((a, b) => byName(a.value.name, b.value.name)), [stored]);
  const [adding, setAdding] = useState(false);
  const [naming, setNaming] = useState<Stored<'asset'> | null>(null);
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
    if (added.data.skipped) toast.error(`${added.data.skipped}개는 추가하지 못했어요.`, { detail: '이미지가 아니거나 너무 커요.' });
  }

  const dragging = useFileDrop((dropped) => void add(dropped), 'screen');

  async function remove({ id, value }: Stored<'asset'>) {
    const removed = await removeAsset(store, id);
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    toast.undoable(`'${value.name}' ${ASSET}을 삭제했어요.`, () => restoreAsset(store, removed.data));
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

  return (
    <Section title={ASSET} note={`${assets.length}개`} help="봇이 {{img::이름}}처럼 이름으로 불러 보여 주는 이미지예요. 이름이 같은 에셋이 여럿이면 그중 하나가 무작위로 나와요. 파일이나 폴더를 끌어다 놓아도 추가돼요.">
      <Stack gap="related">
        <Row kind="toolbar">
          {search.field}
          <FileButton accept="image/*" multiple size="sm" icon={ACTS.create.icon} busy={adding} onFiles={(picked) => void add(picked)}>
            {addOf(ASSET)}
          </FileButton>
        </Row>
        {search.found.length > 0 ? (
          <CardGrid label={ASSET} keys={search.found.map(({ id }) => id)}>
            {(index) => {
              const asset = search.found[index]!;
              return <AssetCard key={asset.id} asset={asset} shared={shared.get(named(asset))!} onRename={() => setNaming(asset)} onReplace={(file) => void replace(asset.id, file)} onRemove={() => void remove(asset)} />;
            }}
          </CardGrid>
        ) : (
          <Empty variant="section">{search.none ?? `${ASSET}이 없어요.`}</Empty>
        )}
      </Stack>
      {dragging && <DropOverlay>여기에 놓으면 에셋으로 추가해요</DropOverlay>}
      {naming && <NameDialog title={`${ASSET} ${ACTS.rename.label}`} value={naming.value.name} hint="봇은 이 이름으로 이미지를 불러요." onSave={rename} onClose={() => setNaming(null)} />}
    </Section>
  );
}

type CardProps = { asset: Stored<'asset'>; shared: number; onRename: () => void; onReplace: (file: File) => void; onRemove: () => void };

// Each card holds its own picture while drawn, so a grid of thousands keeps only the rows on screen.
function AssetCard({ asset: { id, value }, shared, onRename, onReplace, onRemove }: CardProps) {
  const url = useAssetUrl();
  const copy = useCopy();
  const handle = useMenuHandle();
  const opener = useMenuOpener(handle);
  return (
    <FaceCard
      image={url('asset', id) ?? null}
      name={value.name}
      note={shared > 1 ? `같은 이름 ${shared}개` : value.type.replace('image/', '').toUpperCase()}
      selected={null}
      {...opener}
      menu={
        <MoreMenu handle={handle} of={`'${value.name}'`}>
          <MenuItem icon={ACTS.copy.icon} label={`태그 ${ACTS.copy.label}`} onClick={() => copy(`{{img::${value.name}}}`)} />
          <MenuItem icon={ACTS.rename.icon} label={ACTS.rename.label} onClick={onRename} />
          <MenuItem icon={ImageUp} label={CHANGE_IMAGE} onClick={() => pickFiles('image/*', false, ([file]) => onReplace(file!))} />
          <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={onRemove} />
        </MoreMenu>
      }
    />
  );
}
