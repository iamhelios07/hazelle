import { useState } from 'react';
import type { Stored } from '../../model/kinds';
import { addAssets, removeAsset, renameAsset, restoreAsset } from '../../runtime/characters';
import { useAssetUrl, useChildren, useFiles, useStore } from '../session';
import { useToast } from '../toast';
import { CardGrid, Empty, FaceCard, FileButton, MenuItem, MoreMenu, Row, Section, Stack, useMenuHandle, useMenuOpener } from '../ui';
import { ACTS, addOf } from './acts';
import { NameDialog } from './NameDialog';
import { useCopy } from './useCopy';
import { useSearch } from './useSearch';

const ASSET = '에셋';

export function AssetsEditor({ owner }: { owner: string }) {
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const assets = useChildren('asset', owner);
  const [adding, setAdding] = useState(false);
  const [naming, setNaming] = useState<Stored<'asset'> | null>(null);
  const search = useSearch(assets, `${ASSET} 검색`, ({ value }) => [value.name]);
  const named = (asset: Stored<'asset'>) => asset.value.name.toLowerCase();
  const shared = new Map<string, number>();
  for (const asset of assets) shared.set(named(asset), (shared.get(named(asset)) ?? 0) + 1);

  async function add(picked: File[]) {
    setAdding(true);
    const added = await addAssets(store, files, owner, picked);
    setAdding(false);
    if (!added.ok) return toast.failed(added, `${ASSET}을 추가하지 못했어요.`);
    if (added.data.skipped) toast.show(`${added.data.skipped}개는 이미지가 아니거나 너무 커서 추가하지 못했어요.`);
  }

  async function remove({ id, value }: Stored<'asset'>) {
    const removed = await removeAsset(store, id);
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    toast.undoable(`'${value.name}' ${ASSET}을 삭제했어요.`, () => restoreAsset(store, removed.data));
  }

  function rename(name: string) {
    const trimmed = name.trim();
    if (!naming || !trimmed) return;
    setNaming(null);
    void renameAsset(store, naming.id, trimmed).then((saved) => saved.ok || toast.failed(saved, '저장하지 못했어요.'));
  }

  return (
    <Section title={ASSET} note={`${assets.length}개`} help="봇이 {{img::이름}}처럼 이름으로 불러 보여 주는 이미지예요. 이름이 같은 에셋이 여럿이면 그중 하나가 무작위로 나와요.">
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
              return <AssetCard key={asset.id} asset={asset} shared={shared.get(named(asset))!} onRename={() => setNaming(asset)} onRemove={() => void remove(asset)} />;
            }}
          </CardGrid>
        ) : (
          <Empty variant="section">{search.none ?? `${ASSET}이 없어요.`}</Empty>
        )}
      </Stack>
      {naming && <NameDialog title={`${ASSET} ${ACTS.rename.label}`} value={naming.value.name} hint="봇은 이 이름으로 이미지를 불러요." onSave={rename} onClose={() => setNaming(null)} />}
    </Section>
  );
}

type CardProps = { asset: Stored<'asset'>; shared: number; onRename: () => void; onRemove: () => void };

// Each card holds its own picture while drawn, so a grid of thousands keeps only the rows on screen.
function AssetCard({ asset: { id, value }, shared, onRename, onRemove }: CardProps) {
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
          <MenuItem icon={ACTS.remove.icon} label={ACTS.remove.label} tone="warn" onClick={onRemove} />
        </MoreMenu>
      }
    />
  );
}
