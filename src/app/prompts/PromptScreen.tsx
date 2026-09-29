import { Copy, Cpu, Ellipsis, SlidersHorizontal } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ModelRef } from '../../connectors/assignment';
import type { Stored } from '../../model/kinds';
import { SLOTS, type Block, type TextBlock, type Toggle } from '../../model/prompt';
import { setPromptModel } from '../../runtime/assignment';
import { copyPrompt, removePrompt, restorePrompt, setDefaultPrompt, type PromptPatch } from '../../runtime/prompts';
import { describeFailure } from '../common/failure';
import { useStore, useViews } from '../session';
import { navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { useToast } from '../toast';
import { Button, Callout, Divider, EditorFrame, IconButton, Menu, MenuHeading, MenuItem, NavBar, NavRow, Outline, Screen, Section, Stack, Tag, typeInto, useWide, type OutlineStop } from '../ui';
import { BlockPane } from './BlockPane';
import { blockIcon, blockKind, blockMeta, blockTitle, hasConditions, isText, MARKS, SLOT, TEXTS } from './blocks';
import { conditionSnippet, countUses, draftOf, moved, newBlock, rekey, withMark, type Draft, type NewBlock } from './edits';
import { ModelPane, modelWords } from './ModelPane';
import { chatWarning } from './ranges';
import { TogglePane } from './TogglePane';
import { useAutosave } from './useAutosave';
import { EMPTY_USE, promptName, usePromptUse } from './usePromptUse';

const MODEL = 'model';
const TOGGLES = 'toggles';
const SAVE_WORDS = { saved: '저장됨', saving: '저장 중…', failed: '저장하지 못함' } as const;
const DEFAULT_REFUSED = '기본 프롬프트는 지울 수 없어요. 다른 프롬프트를 기본으로 정한 뒤 지워 주세요.';
const HELP = '위아래 화살표로 블록 사이를 오가고, Alt와 함께 누르면 순서를 바꿔요. Enter로 글을 고치고, Delete로 빼요. 맨 위가 맨 처음 보내는 블록, 맨 아래가 답장 직전이에요.';

type Props = { stored: Stored<'prompt'>; pane: 'toggles' | null; back: Back };

// design §4.2: one prompt as an outline of its blocks, in the order they are sent, beside the one block picked from
// it. On a phone the outline is the page, and a block opens a page of its own.
export function PromptScreen({ stored, pane, back }: Props) {
  const store = useStore();
  const toast = useToast();
  const { settings, connections } = useViews();
  const uses = usePromptUse().get(stored.id) ?? EMPTY_USE;
  const wide = useWide();
  const save = useAutosave(stored.id);

  const [draft, setDraft] = useState<Draft>(() => draftOf(stored.value));
  const latest = useRef(draft);
  // Another device's edit comes in while nothing here waits to be saved.
  useEffect(() => {
    if (!save.idle()) return;
    latest.current = draftOf(stored.value);
    setDraft(latest.current);
  }, [stored]);
  const update = (change: (current: Draft) => PromptPatch) => {
    const patch = change(latest.current);
    latest.current = { ...latest.current, ...patch };
    setDraft(latest.current);
    save.queue(patch);
  };
  const setBlocks = (change: (blocks: Block[]) => Block[]) => update((current) => ({ blocks: change(current.blocks) }));

  const firstText = () => latest.current.blocks.find(isText)?.id ?? MODEL;
  const [picked, setPicked] = useState<string>(firstText);
  const [drilled, setDrilled] = useState(pane === TOGGLES);
  const [reordering, setReordering] = useState(false);
  const [addingToggle, setAddingToggle] = useState(false);
  const open = pane === TOGGLES ? TOGGLES : picked === MODEL || draft.blocks.some((block) => block.id === picked) ? picked : firstText();
  const index = draft.blocks.findIndex((block) => block.id === open);
  const block = draft.blocks[index];

  const textRef = useRef<HTMLTextAreaElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // A selection to set once the text it falls in is on the page: after 조건 넣기, or Enter from the outline.
  const select = useRef<[number, number] | 'name' | 'text' | null>(null);
  const applySelect = () => {
    const want = select.current;
    select.current = null;
    const area = textRef.current;
    if (want === null) return;
    if (want === 'name' || !area) {
      nameRef.current?.focus();
      return;
    }
    area.focus();
    if (Array.isArray(want)) area.setSelectionRange(...want);
  };
  useLayoutEffect(applySelect);

  const pick = (id: string) => {
    if (!wide) setDrilled(true);
    if (id === TOGGLES) return navigate({ kind: 'prompt', id: stored.id, pane: 'toggles' }, { replace: true });
    setPicked(id);
    if (pane) navigate({ kind: 'prompt', id: stored.id, pane: null }, { replace: true });
  };
  const leavePage = () => {
    setDrilled(false);
    if (pane) navigate({ kind: 'prompt', id: stored.id, pane: null }, { replace: true });
  };

  const change = (next: Block) => setBlocks((blocks) => blocks.map((each) => (each.id === next.id ? next : each)));
  const insert = (at: number, kind: NewBlock) => {
    const added = newBlock(kind);
    setBlocks((blocks) => [...blocks.slice(0, at), added, ...blocks.slice(at)]);
    pick(added.id);
    select.current = added.kind === 'text' ? 'text' : 'name';
  };
  const move = (from: number, to: number) => setBlocks((blocks) => moved(blocks, from, to));
  const remove = (id: string) => {
    const at = latest.current.blocks.findIndex((each) => each.id === id);
    const gone = latest.current.blocks[at];
    if (!gone) return;
    const next = latest.current.blocks[at + 1] ?? latest.current.blocks[at - 1];
    setBlocks((blocks) => blocks.filter((each) => each.id !== id));
    if (open === id) setPicked(next?.id ?? MODEL);
    toast.undoable(`‘${blockTitle(gone).title}’ 블록을 뺐어요.`, () => setBlocks((blocks) => [...blocks.slice(0, at), gone, ...blocks.slice(at)]));
  };
  const mark = (id: string, value: TextBlock['mark']) => {
    const { blocks, taken } = withMark(latest.current.blocks, id, value);
    setBlocks(() => blocks);
    if (value && taken) toast.show(`‘${MARKS[value].label}’ 표시를 이 글로 옮겼어요.`);
  };
  const unwrap = (target: Block) => {
    if (!('wrapper' in target) || target.wrapper === null) return;
    const wrapper = target.wrapper;
    change({ ...target, wrapper: null });
    toast.undoable('감싸는 글을 뺐어요.', () => setBlocks((blocks) => blocks.map((each) => (each.id === target.id && 'wrapper' in each ? { ...each, wrapper } : each))));
  };
  const condition = (toggle: Toggle) => {
    const area = textRef.current!;
    const { selectionStart: start, selectionEnd: end } = area;
    const snippet = conditionSnippet(toggle, area.value.slice(start, end));
    select.current = [start + snippet.select[0], start + snippet.select[1]];
    typeInto(area, [start, end], snippet.text);
  };
  const removeToggle = (key: string) => {
    const at = latest.current.toggles.findIndex((toggle) => toggle.key === key);
    const gone = latest.current.toggles[at];
    if (!gone) return;
    update((current) => ({ toggles: current.toggles.filter((toggle) => toggle.key !== key) }));
    toast.undoable(`‘${gone.label}’ 토글을 지웠어요. 글 속 조건은 그대로예요.`, () => update((current) => ({ toggles: [...current.toggles.slice(0, at), gone, ...current.toggles.slice(at)] })));
  };
  const renameKey = (from: string, to: string) => {
    const count = countUses(latest.current, from);
    update((current) => rekey(current, from, to));
    toast.show(count ? `이름을 바꾸고 글 속 조건 ${count}곳도 함께 바꿨어요.` : '이름을 바꿨어요.');
  };
  const pickModel = async (ref: ModelRef | null) => {
    const saved = await setPromptModel(store, stored.id, ref);
    if (!saved.ok) toast.failed(saved, '모델을 바꾸지 못했어요.');
  };

  const isDefault = settings.prompt === stored.id;
  const copy = async () => {
    await save.flush();
    const copied = await copyPrompt(store, stored.id, `${promptName(latest.current.name)} (사본)`);
    if (!copied.ok) return toast.failed(copied, '사본을 만들지 못했어요.');
    navigate({ kind: 'prompt', id: copied.data.id, pane: null });
    toast.show('사본을 만들었어요. 이름부터 바꿔 보세요.');
  };
  const makeDefault = async () => {
    const saved = await setDefaultPrompt(store, stored.id);
    if (!saved.ok) toast.failed(saved, '기본으로 정하지 못했어요.');
  };
  const erase = async () => {
    await save.flush();
    const removed = await removePrompt(store, stored.id);
    if (!removed.ok) return removed.error === 'default' ? toast.show(DEFAULT_REFUSED) : toast.failed(removed, '지우지 못했어요.');
    navigate(back.to, { replace: true });
    toast.undoable(`‘${promptName(removed.data.value.name)}’을(를) 지웠어요.`, () => {
      void restorePrompt(store, removed.data).then((restored) => restored.ok || toast.show(`되돌리지 못했어요. ${describeFailure(restored)}`));
    });
  };

  const stops: OutlineStop[] = draft.blocks.map((each, at) => {
    const { title, dim } = blockTitle(each);
    const meta = blockMeta(each);
    const badge = each.kind === 'text' && each.mark ? MARKS[each.mark].label : undefined;
    const flagged = hasConditions(each);
    const words = [`${at + 1}. ${title}`, badge, meta, flagged && '토글 조건 있음'].filter(Boolean).join(', ');
    return { id: each.id, kind: blockKind(each), icon: blockIcon(each), title, dim, meta, badge, flagged, label: words };
  });
  const placed = new Set(draft.blocks.flatMap((each) => (each.kind === 'slot' ? [each.slot] : [])));
  const addMenu = (at: number) => (
    <>
      <MenuHeading>직접 쓰는 글</MenuHeading>
      {TEXTS.map((text) => (
        <MenuItem key={text.role} label={text.name} sub={text.hint} onClick={() => insert(at, { text: text.role })} />
      ))}
      <Divider variant="menu" />
      <MenuHeading>앱이 채우는 자리</MenuHeading>
      {(Object.keys(SLOT) as (keyof typeof SLOT)[]).map((slot) => {
        const taken = !SLOTS[slot].repeats && placed.has(slot);
        const there = draft.blocks.find((each) => each.kind === 'slot' && each.slot === slot);
        return taken && there ? (
          <MenuItem key={slot} tone="muted" label={SLOT[slot].name} sub="이미 있어요 · 눌러서 그 자리로" onClick={() => pick(there.id)} />
        ) : (
          <MenuItem key={slot} label={SLOT[slot].name} sub={SLOT[slot].hint} onClick={() => insert(at, { slot })} />
        );
      })}
    </>
  );

  const warning = chatWarning(draft.blocks);
  const model = modelWords(stored.value.models, connections);
  const outline = (
    <>
      <Stack gap="related">
        <NavRow icon={Cpu} label="모델" meta={model} current={wide && open === MODEL} onClick={() => pick(MODEL)} />
        <NavRow icon={SlidersHorizontal} label="토글" meta={`${draft.toggles.length}개`} current={wide && open === TOGGLES} onClick={() => pick(TOGGLES)} />
      </Stack>
      <Section
        title="보내는 순서"
        level={3}
        note={`${draft.blocks.length}개`}
        action={
          !wide && (
            <Button variant="link" size="xs" onClick={() => setReordering(!reordering)}>
              {reordering ? '다 했어요' : '순서 바꾸기'}
            </Button>
          )
        }
      >
        {warning && <Callout tone="warn">{warning}</Callout>}
        <Outline
          label="보내는 순서"
          help={HELP}
          start="맨 처음"
          end="답장 직전"
          stops={stops}
          current={wide ? open : null}
          onPick={pick}
          onOpen={(id) => {
            select.current = draft.blocks.find((each) => each.id === id)?.kind === 'text' ? 'text' : 'name';
            // The block already open renders nothing new, so nothing would take the focus after it.
            if (wide && id === open) applySelect();
            else pick(id);
          }}
          onRemove={remove}
          onMove={move}
          insert={addMenu}
          reorder={reordering ? 'buttons' : 'drag'}
          drill={!wide}
        />
      </Section>
    </>
  );

  const page: ReactNode =
    open === MODEL ? (
      <ModelPane models={stored.value.models} defaults={settings.models} connections={connections} onPick={(ref) => void pickModel(ref)} />
    ) : open === TOGGLES ? (
      <TogglePane
        toggles={draft.toggles}
        uses={(key) => countUses(latest.current, key)}
        onChange={(toggles) => update(() => ({ toggles }))}
        onRekey={renameKey}
        onRemove={removeToggle}
        adding={addingToggle}
        onAdding={setAddingToggle}
      />
    ) : (
      block && (
        <BlockPane
          key={block.id}
          block={block}
          index={index}
          count={draft.blocks.length}
          toggles={draft.toggles}
          authorNote={draft.authorNote}
          onChange={change}
          onUnwrap={() => unwrap(block)}
          onAuthorNote={(authorNote) => update(() => ({ authorNote }))}
          onMark={(value) => mark(block.id, value)}
          onMove={(to) => move(index, to)}
          onRemove={() => remove(block.id)}
          onCondition={condition}
          onNewToggle={() => {
            setAddingToggle(true);
            pick(TOGGLES);
          }}
          textRef={textRef}
          nameRef={nameRef}
        />
      )
    );

  const origin = stored.value.imported === 'risu-preset' ? 'Risu 프리셋에서 가져옴' : stored.value.origin ? `‘${promptName(stored.value.origin.name)}’의 사본` : null;
  const subtitle = (
    <>
      {isDefault && <Tag tone="accent">새 채팅의 기본</Tag>}
      <span>{[uses.chats ? `채팅 ${uses.chats}개가 쓰는 중` : '쓰는 채팅 없음', origin].filter(Boolean).join(' · ')}</span>
    </>
  );
  const more = (
    <Menu label="프롬프트 더 보기" place="below-end" trigger={(opener) => <IconButton icon={Ellipsis} label="프롬프트 더 보기" title="더 보기" {...opener} />}>
      {!wide && <MenuItem icon={Copy} label="사본 만들기" onClick={() => void copy()} />}
      {!isDefault && <MenuItem label="기본으로 정하기" sub="새 채팅이 이 프롬프트로 시작해요" onClick={() => void makeDefault()} />}
      <MenuItem label="지우기" tone="warn" onClick={() => void erase()} />
    </Menu>
  );
  const top = (
    <NavBar
      title={draft.name}
      rename={{ label: '프롬프트 이름', placeholder: promptName(''), onChange: (name) => update(() => ({ name })) }}
      subtitle={subtitle}
      onBack={() => navigate(back.to)}
      backLabel={back.label}
      status={SAVE_WORDS[save.state]}
      actions={
        <>
          {wide && (
            <Button variant="secondary" size="sm" icon={Copy} onClick={() => void copy()}>
              사본 만들기
            </Button>
          )}
          {more}
        </>
      }
    />
  );

  if (wide) {
    return (
      <EditorFrame top={top} side={outline} page={open}>
        {page}
      </EditorFrame>
    );
  }
  if (drilled) {
    const title = open === MODEL ? '모델' : open === TOGGLES ? '토글' : block ? blockTitle(block).title : '';
    return <Screen top={<NavBar title={title} onBack={leavePage} backLabel="보내는 순서" status={SAVE_WORDS[save.state]} />}>{page}</Screen>;
  }
  return (
    <Screen top={top}>
      <Stack gap="section">{outline}</Stack>
    </Screen>
  );
}
