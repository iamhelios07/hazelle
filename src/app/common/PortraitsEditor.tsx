import { likenessId, type Portrait, type PortraitSource } from '../../model/likeness';
import { editPortrait, type PortraitEdit } from '../../runtime/likeness';
import { useLikenessRuns, useLikenesses, useStore, useStored } from '../session';
import { Button, Callout, Empty, MarkupArea, Section, Stack } from '../ui';
import { describeLikenessFailure } from './failure';
import { useAutosave } from './useAutosave';

const SOURCES: Record<PortraitSource, string> = { metadata: '이미지 정보에서', vision: '이미지를 보고', text: '설명에서' };

// The 삽화 profiles of a character, module or persona (design §6.6): made by the first 삽화 that needs them, and only
// their tags are edited here.
export function PortraitsEditor({ owner }: { owner: string }) {
  const stored = useStored('likeness', likenessId(owner));
  const run = useLikenessRuns().get(owner);
  const likenesses = useLikenesses();
  const building = run?.stage === 'building';
  const portraits = stored?.value.portraits ?? [];
  return (
    <Stack gap="section">
      <Section
        title="삽화 프로필"
        note={building ? '만드는 중' : undefined}
        help="삽화에서 인물을 늘 같은 외모로 그리도록 쓰는 태그예요. 처음 삽화를 그릴 때 만들어져요."
        action={
          <Button variant="link" disabled={building} onClick={() => likenesses.rebuild(owner)}>
            {stored ? '다시 만들기' : '지금 만들기'}
          </Button>
        }
      >
        {run?.stage === 'failed' && <Callout tone="warn">{`프로필을 만들지 못했어요. ${describeLikenessFailure(run.failure)}`}</Callout>}
        {!stored ? <Empty variant="section">아직 없어요.</Empty> : portraits.length === 0 && <Empty variant="section">외모가 적힌 인물이 없어요.</Empty>}
      </Section>
      {portraits.map((portrait) => (
        <PortraitTags key={portrait.name} owner={owner} portrait={portrait} />
      ))}
    </Stack>
  );
}

// Keys: look, artist, and outfit:<name> for each outfit.
type Fields = Record<string, string>;
const OUTFIT = 'outfit:';

function PortraitTags({ owner, portrait }: { owner: string; portrait: Portrait }) {
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
    <Section title={portrait.name} note={`${aliases}${SOURCES[portrait.source]}`}>
      <Stack gap="related">
        {field('look', '외모', portrait.look)}
        {portrait.outfits.map(({ name, tags }, index) => field(`${OUTFIT}${name}`, index === 0 ? `옷 · ${name} (기본)` : `옷 · ${name}`, tags))}
        {field('artist', '작가', portrait.artist)}
      </Stack>
    </Section>
  );
}
