import { likenessId, type Portrait, type PortraitSource } from '../../model/likeness';
import { editPortrait, removeLikeness, removePortrait, restoreLikeness, type PortraitEdit } from '../../runtime/likeness';
import { useLikenessRuns, useLikenesses, useStore, useStored } from '../session';
import { useToast } from '../toast';
import { Button, Callout, Empty, IconButton, MarkupArea, MenuItem, MoreMenu, Section, Stack } from '../ui';
import { ACTS } from './acts';
import { describeLikenessFailure } from './failure';
import { useAutosave } from './useAutosave';

const SOURCES: Record<PortraitSource, string> = { metadata: '이미지 정보에서', vision: '이미지를 보고', text: '설명에서' };

// The 삽화 profiles of a character, module or persona (design §6.6): made by the first 삽화 that needs them, and only
// their tags are edited here.
export function PortraitsEditor({ owner }: { owner: string }) {
  const store = useStore();
  const toast = useToast();
  const stored = useStored('likeness', likenessId(owner));
  const run = useLikenessRuns().get(owner);
  const likenesses = useLikenesses();
  const building = run?.stage === 'building';
  const portraits = stored?.value.portraits ?? [];

  async function removeAll() {
    const removed = await removeLikeness(store, owner);
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    toast.undoable('삽화 프로필을 삭제했어요.', () => restoreLikeness(store, removed.data));
  }

  async function remove(name: string) {
    const removed = await removePortrait(store, owner, name);
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    toast.undoable(`'${name}' 프로필을 삭제했어요.`, () => restoreLikeness(store, removed.data));
  }

  return (
    <Stack gap="section">
      <Section
        title="삽화 프로필"
        note={building ? '만드는 중' : undefined}
        help="삽화에서 인물을 늘 같은 외모로 그리도록 쓰는 태그예요. 처음 삽화를 그릴 때 만들어져요."
        action={
          <>
            <Button variant="link" disabled={building} onClick={() => likenesses.rebuild(owner)}>
              {stored ? '다시 만들기' : '지금 만들기'}
            </Button>
            {stored && !building && (
              <MoreMenu of="삽화 프로필">
                <MenuItem icon={ACTS.remove.icon} label={`모두 ${ACTS.remove.label}`} sub="다음에 삽화를 그릴 때 다시 만들어져요" tone="warn" onClick={() => void removeAll()} />
              </MoreMenu>
            )}
          </>
        }
      >
        {run?.stage === 'failed' && <Callout tone="warn">{`프로필을 만들지 못했어요. ${describeLikenessFailure(run.failure)}`}</Callout>}
        {!stored ? <Empty variant="section">프로필이 없어요.</Empty> : portraits.length === 0 && <Empty variant="section">삽화에 쓸 인물이 없어요.</Empty>}
      </Section>
      {portraits.map((portrait) => (
        <PortraitTags key={portrait.name} owner={owner} portrait={portrait} onRemove={building ? undefined : () => void remove(portrait.name)} />
      ))}
    </Stack>
  );
}

// Keys: look, artist, and outfit:<name> for each outfit.
type Fields = Record<string, string>;
const OUTFIT = 'outfit:';

function PortraitTags({ owner, portrait, onRemove }: { owner: string; portrait: Portrait; onRemove: (() => void) | undefined }) {
  const store = useStore();
  const save = useAutosave<Fields>(`likeness:${owner}:${portrait.name}`, async (patch) => {
    for (const [key, tags] of Object.entries(patch)) {
      if (tags === undefined) continue;
      const edit: PortraitEdit = key === 'look' ? { look: tags } : key === 'artist' ? { artist: tags } : { outfit: key.slice(OUTFIT.length), tags };
      const saved = await editPortrait(store, owner, portrait.name, edit);
      if (!saved.ok) return saved;
    }
    return { ok: true };
  });
  const shown = (key: string, stored: string) => save.unsaved[key] ?? stored;
  const field = (key: string, label: string, stored: string) => (
    <Section key={key} title={label} level={3}>
      <MarkupArea label={`${portrait.name} ${label}`} variant="field" kind="tags" value={shown(key, stored)} onChange={(tags) => save.change({ [key]: tags })} />
    </Section>
  );
  const aliases = portrait.aliases.length ? `${portrait.aliases.join(', ')} · ` : '';
  return (
    <Section
      title={portrait.name}
      note={`${aliases}${SOURCES[portrait.source]}`}
      action={onRemove && <IconButton icon={ACTS.remove.icon} label={`${portrait.name} ${ACTS.remove.label}`} size="sm" onClick={onRemove} />}
    >
      <Stack gap="related">
        {field('look', '외모', portrait.look)}
        {portrait.outfits.map(({ name, tags }, index) => field(`${OUTFIT}${name}`, index === 0 ? `옷 · ${name} (기본)` : `옷 · ${name}`, tags))}
        {field('artist', '작가', portrait.artist)}
      </Stack>
    </Section>
  );
}
