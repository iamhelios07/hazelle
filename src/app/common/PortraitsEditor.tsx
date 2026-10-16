import { useRef, useState } from 'react';
import { likenessId, PORTRAITS_MOST, type Portrait, type PortraitSource } from '../../model/likeness';
import { addPortrait, editPortrait, removeLikeness, removePortrait, restoreLikeness } from '../../runtime/likeness';
import { useLikenessRuns, useLikenesses, useSaves, useStore, useStored } from '../session';
import { useToast } from '../toast';
import { Button, Callout, Empty, IconButton, MarkupArea, MenuItem, MoreMenu, PhraseField, Section, Stack, TextField } from '../ui';
import { ACTS, addOf } from './acts';
import { describeLikenessFailure } from './failure';
import { filled, typedText } from './typed';
import { useAutosave } from './useAutosave';

const SOURCES: Record<PortraitSource, string> = { metadata: '이미지 정보에서', vision: '이미지를 보고', text: '설명에서', user: '직접 입력' };
const UNNAMED = '이름 없음';

// By place, so a rename keeps its field; a portrait's place moves only by this screen's add and remove, and 다시
// 만들기, which flush the edits first.
const saveKey = (owner: string, index: number) => `likeness:${owner}:${index}`;

// The 삽화 profiles of a character, module or persona (design §6.6): made by the first 삽화 that needs them, and
// edited or added here; an edited or added one is the user's, which 다시 만들기 keeps.
export function PortraitsEditor({ owner }: { owner: string }) {
  const store = useStore();
  const saves = useSaves();
  const toast = useToast();
  const stored = useStored('likeness', likenessId(owner));
  const run = useLikenessRuns().get(owner);
  const likenesses = useLikenesses();
  const building = run?.stage === 'building';
  const portraits = stored?.value.portraits ?? [];
  const settle = () => Promise.all(portraits.map((_, index) => saves.flush(saveKey(owner, index))));

  async function rebuild() {
    await settle();
    const before = await likenesses.rebuild(owner);
    if (before) toast.undoable('삽화 프로필을 새로 만들었어요.', () => restoreLikeness(store, before));
  }

  async function add() {
    await settle();
    const added = await addPortrait(store, owner);
    if (!added.ok) toast.failed(added, '추가하지 못했어요.');
  }

  async function removeAll() {
    await settle();
    const removed = await removeLikeness(store, owner);
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    toast.undoable('삽화 프로필을 삭제했어요.', () => restoreLikeness(store, removed.data));
  }

  async function remove(index: number, name: string) {
    await settle();
    const removed = await removePortrait(store, owner, { index, name });
    if (!removed.ok) return toast.failed(removed, '삭제하지 못했어요.');
    toast.undoable(`'${name || UNNAMED}' 프로필을 삭제했어요.`, () => restoreLikeness(store, removed.data));
  }

  return (
    <Stack gap="section">
      <Section
        title="삽화 프로필"
        note={building ? '만드는 중' : undefined}
        help="삽화에서 인물을 늘 같은 모습으로 그릴 때 쓰는 태그예요. 처음 삽화를 그릴 때 자동으로 만들어지고, 직접 고치거나 추가한 프로필은 다시 만들어도 그대로 남아요."
        action={
          <>
            <Button variant="link" disabled={building} onClick={() => void rebuild()}>
              {stored ? '다시 만들기' : '지금 만들기'}
            </Button>
            {stored && !building && (
              <MoreMenu of="삽화 프로필">
                <MenuItem icon={ACTS.remove.icon} label={`모두 ${ACTS.remove.label}`} sub="다음에 삽화를 그릴 때 새로 만들어져요" tone="warn" onClick={() => void removeAll()} />
              </MoreMenu>
            )}
          </>
        }
      >
        {run?.stage === 'failed' && <Callout tone="warn">{`프로필을 만들지 못했어요. ${describeLikenessFailure(run.failure)}`}</Callout>}
        {!stored ? <Empty variant="section">프로필이 없어요.</Empty> : portraits.length === 0 && <Empty variant="section">삽화에 넣을 인물이 없어요.</Empty>}
      </Section>
      {portraits.map((portrait, index) => (
        <PortraitFields key={index} owner={owner} index={index} portrait={portrait} onRemove={building ? undefined : () => void remove(index, portrait.name)} />
      ))}
      {/* Not before the first build: a pack holding a likeness gets none built by the next 삽화. */}
      {stored && !building && portraits.length < PORTRAITS_MOST && (
        <div>
          <Button variant="secondary" size="sm" icon={ACTS.create.icon} onClick={() => void add()}>
            {addOf('인물')}
          </Button>
        </div>
      )}
    </Stack>
  );
}

type Fields = Omit<Portrait, 'source'>;

function PortraitFields({ owner, index, portrait, onRemove }: { owner: string; index: number; portrait: Portrait; onRemove: (() => void) | undefined }) {
  const store = useStore();
  // The name the store holds, which finds the portrait: a rename saved moves it before the next render shows it.
  const named = useRef(portrait.name);
  named.current = portrait.name;
  const save = useAutosave<Fields>(saveKey(owner, index), async (patch) => {
    const saved = await editPortrait(store, owner, { index, name: named.current }, patch);
    if (!saved.ok) return saved;
    if (patch.name !== undefined) named.current = patch.name;
    return { ok: true };
  });
  const shown = <K extends keyof Fields>(key: K): Fields[K] => save.unsaved[key] ?? portrait[key];
  const [typed, setTyped] = useState<string>();
  const name = typedText(typed, filled, shown('name'), String);
  const outfits = shown('outfits');
  const label = portrait.name || UNNAMED;
  const tags = (title: string, value: string, change: (tags: string) => void) => (
    <MarkupArea label={`${label} ${title}`} variant="field" kind="tags" value={value} onChange={change} />
  );
  return (
    <Section
      title={label}
      note={SOURCES[portrait.source]}
      action={onRemove && <IconButton icon={ACTS.remove.icon} label={`${label} ${ACTS.remove.label}`} size="sm" onClick={onRemove} />}
    >
      <Stack gap="related">
        <TextField
          label="이름"
          value={name}
          onChange={(next) => {
            setTyped(next);
            save.change({ name: next }, next.trim() !== '');
          }}
          error={name.trim() ? undefined : '이름을 적어 주세요.'}
        />
        <Section title="별명" level={3} help="이야기에서 이 이름으로 불려도 같은 모습으로 그려요.">
          <PhraseField label={`${label} 별명`} phrases={shown('aliases')} onChange={(aliases) => save.change({ aliases })} />
        </Section>
        <Section title="외모" level={3}>
          {tags('외모', shown('look'), (look) => save.change({ look }))}
        </Section>
        {outfits.map((outfit, at) => (
          <Section
            key={at}
            title={at === 0 ? '옷 (기본)' : '옷'}
            level={3}
            action={<IconButton icon={ACTS.remove.icon} label={`${outfit.name || '옷'} ${ACTS.remove.label}`} size="sm" onClick={() => save.change({ outfits: outfits.toSpliced(at, 1) })} />}
          >
            <Stack gap="related">
              <TextField label="옷 이름" showLabel={false} placeholder="옷 이름" value={outfit.name} onChange={(next) => save.change({ outfits: outfits.with(at, { ...outfit, name: next }) })} />
              {tags(`옷 ${outfit.name}`, outfit.tags, (next) => save.change({ outfits: outfits.with(at, { ...outfit, tags: next }) }))}
            </Stack>
          </Section>
        ))}
        <div>
          <Button variant="link" onClick={() => save.change({ outfits: [...outfits, { name: '', tags: '' }] })}>
            {addOf('옷')}
          </Button>
        </div>
        <Section title="작가" level={3}>
          {tags('작가', shown('artist'), (artist) => save.change({ artist }))}
        </Section>
      </Stack>
    </Section>
  );
}
