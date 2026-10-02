import { Copy, Cpu, Ellipsis, SlidersHorizontal } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ModelRef, Role } from '../../connectors/assignment';
import type { Stored } from '../../model/kinds';
import { slotsOf, SLOTS, sortOf, type Block, type PromptSort, type TextBlock, type Toggle, type WrappedSlot } from '../../model/prompt';
import { setPromptModel, setTaskModel } from '../../runtime/assignment';
import { copyPrompt, editPrompt, isDefaultPrompt, removePrompt, restorePrompt, setDefaultPrompt, type PromptPatch } from '../../runtime/prompts';
import { SAVE_STATUS, useAutosave } from '../common/useAutosave';
import { useConnections, useSettings, useStore } from '../session';
import { typing, useShortcut } from '../shortcuts';
import { useOwnUndo, useToast } from '../toast';
import { Button, Callout, Divider, IconButton, Menu, MenuHeading, MenuItem, NavRow, Outline, Section, Stack, Tag, typeInto, type NavBarProps, type OutlineStop } from '../ui';
import { BlockPane } from './BlockPane';
import { blockIcon, blockKind, blockMeta, blockTitle, cacheMarks, hasConditions, isText, MARKS, rangeKey, SLOT, TEXTS } from './blocks';
import { conditionSnippet, countUses, draftOf, newBlock, withMark, type Draft, type NewBlock, type Snippet } from './edits';
import {
  addBlock,
  addToggle,
  editToggle,
  moveBlock,
  NO_HISTORY,
  recorded,
  redoing,
  removeBlock,
  removeToggle,
  renameKey,
  setCache,
  setCount,
  setMark,
  setRange,
  setRole,
  setWrapper,
  undoing,
  type Step,
} from './history';
import { ModelPane, modelWords, TaskModelPane, taskModelWords } from './ModelPane';
import { chatWarning } from './ranges';
import { TogglePane } from './TogglePane';
import { EMPTY_USE, promptName, usePromptUse } from './usePromptUse';

const MODEL = 'model';
const TOGGLES = 'toggles';
const SORT_WORDS = {
  conversation: { default: '새 채팅의 기본', makeDefault: '새 채팅이 이 프롬프트로 시작해요', refused: ['기본 프롬프트는 지울 수 없어요.', '다른 프롬프트를 기본으로 정한 뒤 지워 주세요.'] },
  translate: {
    default: '기본 번역 프롬프트',
    makeDefault: '번역 프롬프트를 따로 고르지 않은 채팅이 이 프롬프트로 번역해요',
    refused: ['기본 번역 프롬프트는 지울 수 없어요.', '다른 번역 프롬프트를 기본으로 정한 뒤 지워 주세요.'],
  },
  memory: {
    default: '기본 기억 프롬프트',
    makeDefault: '장기 기억을 이 프롬프트로 정리해요',
    refused: ['기본 기억 프롬프트는 지울 수 없어요.', '다른 기억 프롬프트를 기본으로 정한 뒤 지워 주세요.'],
  },
} satisfies Record<PromptSort, { default: string; makeDefault: string; refused: [string, string] }>;
const HELP = '위아래 화살표로 블록 사이를 오가고, Alt와 함께 누르면 순서를 바꿔요. Enter로 글을 고치고, Delete로 빼요. 맨 위가 맨 처음 보내는 블록, 맨 아래가 답장 직전이에요.';

type Pane = 'toggles' | null;

const CACHE_WORDS = { set: '여기까지 캐시', auto: '자동 캐시' } as const;

// side: the outline, beside the open part, in the split layout only. open: the part open, which a frame scrolls back
// to the top of when it changes.
type Parts = { head: NavBarProps; body: ReactNode; side?: ReactNode; open: string };

type Props = {
  stored: Stored<'prompt'>;
  // split: the outline beside the open part. drill: the outline alone, and a part opens in its place. The caller
  // decides, since a side panel is narrow on any screen.
  layout: 'split' | 'drill';
  // The 토글 pane is open: a page keeps it in its address, a panel in its own state.
  pane: Pane;
  onPane: (pane: Pane) => void;
  backLabel: string;
  onBack: () => void;
  // The copy just made, to open in this one's place.
  onCopied: (id: string) => void;
  onErased: () => void;
  // A page or a side panel: the editor says what its head holds, the caller how it looks.
  frame: (parts: Parts) => ReactNode;
};

// Its state is one prompt's, so a caller keys it by id; unmounting it saves.
export function PromptEditor({ stored, layout, pane, onPane, backLabel, onBack, onCopied, onErased, frame }: Props) {
  const store = useStore();
  const toast = useToast();
  const settings = useSettings();
  const connections = useConnections();
  const uses = usePromptUse().get(stored.id) ?? EMPTY_USE;
  const split = layout === 'split';
  const save = useAutosave<PromptPatch>(`prompt:${stored.id}`, (patch) => editPrompt(store, stored.id, patch));
  const sort = sortOf(stored.value);
  const words = SORT_WORDS[sort];

  // The stored prompt under what waits to be saved, so another device's edit to a field nothing here changed shows.
  const draft: Draft = { ...draftOf(stored.value), ...save.unsaved };
  // The draft with the edits made since this render, for one made right after another.
  const latest = useRef(draft);
  latest.current = draft;
  const update = (change: (current: Draft) => PromptPatch) => {
    const patch = change(latest.current);
    latest.current = { ...latest.current, ...patch };
    save.change(patch);
  };

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
  // A selection to set once the text it falls in is on the page: after 조건 넣기 or 명령어 넣기, or Enter from the outline.
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
    if (!split) setDrilled(true);
    if (id === TOGGLES) return onPane(TOGGLES);
    setPicked(id);
    if (pane) onPane(null);
  };
  const leavePage = () => {
    setDrilled(false);
    if (pane) onPane(null);
  };

  // Every structural edit is a step on this one stack; a toast's 되돌리기 undoes its own step, and leaves with the
  // editor, whose stack it is.
  const undoable = useOwnUndo();
  const history = useRef(NO_HISTORY);
  const perform = (step: Step) => {
    update(step.redo);
    history.current = recorded(history.current, step);
    return step;
  };
  const undo = (step?: Step) => {
    const undone = undoing(history.current, step);
    if (!undone) return null;
    history.current = undone.history;
    update(undone.step.undo);
    return undone.step;
  };
  const redo = () => {
    const redone = redoing(history.current);
    if (!redone) return null;
    history.current = redone.history;
    update(redone.step.redo);
    return redone.step;
  };
  const report = (step: Step | null, words: string) => {
    if (!step) return false;
    if (split && step.block !== null && latest.current.blocks.some((each) => each.id === step.block)) pick(step.block);
    toast.show(`${words}: ${step.label}`);
  };
  // The editor's steps are everything but what is typed in a text field.
  useShortcut('undo', (event) => (typing(event) ? false : report(undo(), '되돌렸어요')));
  useShortcut('redo', (event) => (typing(event) ? false : report(redo(), '다시 했어요')));

  const change = (next: Block) => update((current) => ({ blocks: current.blocks.map((each) => (each.id === next.id ? next : each)) }));
  const insert = (at: number, kind: NewBlock) => {
    const added = newBlock(kind);
    perform(addBlock(added, at));
    pick(added.id);
    select.current = added.kind === 'text' ? 'text' : 'name';
  };
  const move = (from: number, to: number) => perform(moveBlock(latest.current.blocks[from]!, from, to));
  const remove = (id: string) => {
    const at = latest.current.blocks.findIndex((each) => each.id === id);
    const gone = latest.current.blocks[at];
    if (!gone) return;
    const next = latest.current.blocks[at + 1] ?? latest.current.blocks[at - 1];
    const step = perform(removeBlock(gone, at));
    if (open === id) setPicked(next?.id ?? MODEL);
    undoable(`‘${blockTitle(gone).title}’ 블록을 뺐어요.`, () => undo(step));
  };
  const mark = (target: TextBlock, value: TextBlock['mark']) => {
    if (value === target.mark) return;
    const { taken } = withMark(latest.current.blocks, target.id, value);
    perform(setMark(target, value, taken));
    if (value && taken) toast.show(`‘${MARKS[value].label}’ 표시를 이 글로 옮겼어요.`);
  };
  const wrap = (target: WrappedSlot, wrapper: string | null) => {
    const step = perform(setWrapper(target, wrapper));
    if (wrapper === null) undoable('감싸는 글을 뺐어요.', () => undo(step));
  };
  const typeSnippet = (snippet: (selected: string) => Snippet) => {
    const area = textRef.current!;
    const { selectionStart: start, selectionEnd: end } = area;
    const { text, select: [from, to] } = snippet(area.value.slice(start, end));
    select.current = [start + from, start + to];
    typeInto(area, [start, end], text);
  };
  const dropToggle = (key: string) => {
    const at = latest.current.toggles.findIndex((toggle) => toggle.key === key);
    const gone = latest.current.toggles[at];
    if (!gone) return;
    const step = perform(removeToggle(gone, at));
    undoable(`‘${gone.label}’ 토글을 지웠어요.`, () => undo(step), '글 속 조건은 그대로예요.');
  };
  const changeKey = (toggle: Toggle, to: string) => {
    const count = countUses(latest.current, toggle.key);
    perform(renameKey(toggle, to));
    toast.show('이름을 바꿨어요.', count ? { detail: `글 속 조건 ${count}곳도 함께 바꿨어요.` } : undefined);
  };
  const pickModel = async (role: Role, ref: ModelRef | null) => {
    const saved = await setPromptModel(store, stored.id, role, ref);
    if (!saved.ok) toast.failed(saved, '모델을 바꾸지 못했어요.');
  };
  const pickTaskModel = async (ref: ModelRef | null) => {
    const saved = await setTaskModel(store, stored.id, ref);
    if (!saved.ok) toast.failed(saved, '모델을 바꾸지 못했어요.');
  };

  const isDefault = isDefaultPrompt(settings, stored);
  const copy = async () => {
    if (!(await save.flush())) return;
    const copied = await copyPrompt(store, stored.id, `${promptName(latest.current.name)} (사본)`);
    if (!copied.ok) return toast.failed(copied, '사본을 만들지 못했어요.');
    onCopied(copied.data.id);
    toast.show('사본을 만들었어요.', { detail: '이름부터 바꿔 보세요.' });
  };
  const makeDefault = async () => {
    const saved = await setDefaultPrompt(store, stored.id);
    if (!saved.ok) toast.failed(saved, '기본으로 정하지 못했어요.');
  };
  const erase = async () => {
    const removed = await save.remove(() => removePrompt(store, stored.id));
    if (!removed) return;
    if (!removed.ok) return removed.error === 'default' ? toast.error(words.refused[0], { detail: words.refused[1] }) : toast.failed(removed, '지우지 못했어요.');
    onErased();
    toast.undoable(`‘${promptName(removed.data.value.name)}’을(를) 지웠어요.`, () => {
      void restorePrompt(store, removed.data).then((restored) => restored.ok || toast.failed(restored, '되돌리지 못했어요.'));
    });
  };

  const cacheAt = (id: string) => {
    const target = latest.current.blocks.find((each) => each.id === id);
    if (target) perform(setCache(target, !target.cache));
  };

  const marks = cacheMarks(draft.blocks);
  const stops: OutlineStop[] = draft.blocks.map((each, at) => {
    const { title, dim } = blockTitle(each);
    const meta = blockMeta(each);
    const badge = each.kind === 'text' && each.mark ? MARKS[each.mark].label : undefined;
    const flagged = hasConditions(each);
    const cache = marks.get(each.id);
    const words = [`${at + 1}. ${title}`, badge, meta, flagged && '토글 조건 있음', cache && CACHE_WORDS[cache]].filter(Boolean).join(', ');
    return { id: each.id, kind: blockKind(each), icon: blockIcon(each), title, dim, meta, badge, flagged, cache, label: words };
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
      {slotsOf(sort).map((slot) => {
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

  const warning = sort === 'conversation' ? chatWarning(draft.blocks) : null;
  const outline = (
    <>
      <Stack gap="related">
        <NavRow
          icon={Cpu}
          label="모델"
          meta={stored.value.task === undefined ? modelWords(stored.value.models, connections) : taskModelWords(stored.value.model, connections)}
          current={split && open === MODEL}
          onClick={() => pick(MODEL)}
        />
        <NavRow icon={SlidersHorizontal} label="토글" meta={`${draft.toggles.length}개`} current={split && open === TOGGLES} onClick={() => pick(TOGGLES)} />
      </Stack>
      <Section
        title="보내는 순서"
        level={3}
        note={`${draft.blocks.length}개`}
        action={
          !split && (
            <Button variant="link" size="xs" onClick={() => setReordering(!reordering)}>
              {reordering ? '완료' : '순서 바꾸기'}
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
          current={split ? open : null}
          onPick={pick}
          onOpen={(id) => {
            select.current = draft.blocks.find((each) => each.id === id)?.kind === 'text' ? 'text' : 'name';
            // The block already open renders nothing new, so nothing would take the focus after it.
            if (split && id === open) applySelect();
            else pick(id);
          }}
          onRemove={remove}
          onMove={move}
          insert={addMenu}
          onCache={cacheAt}
          reorder={reordering ? 'buttons' : 'drag'}
          drill={!split}
        />
      </Section>
    </>
  );

  const page: ReactNode =
    open === MODEL ? (
      stored.value.task === undefined ? (
        <ModelPane models={stored.value.models} defaults={settings.models} connections={connections} onPick={(role, ref) => void pickModel(role, ref)} />
      ) : (
        <TaskModelPane task={stored.value.task} own={stored.value.model} connections={connections} onPick={(ref) => void pickTaskModel(ref)} />
      )
    ) : open === TOGGLES ? (
      <TogglePane
        toggles={draft.toggles}
        uses={(key) => countUses(latest.current, key)}
        onAdd={(toggle) => perform(addToggle(toggle, latest.current.toggles.length))}
        onEdit={(before, after, what) => before[what] !== after[what] && perform(editToggle(before, after, what))}
        onRekey={changeKey}
        onRemove={dropToggle}
        adding={addingToggle}
        onAdding={setAddingToggle}
      />
    ) : (
      block && (
        <BlockPane
          key={block.id}
          block={block}
          sort={sort}
          index={index}
          count={draft.blocks.length}
          toggles={draft.toggles}
          authorNote={draft.authorNote}
          onChange={change}
          onRole={(target, role) => role !== target.role && perform(setRole(target, role))}
          onRange={(target, range) => rangeKey(range) !== rangeKey(target.range) && perform(setRange(target, range))}
          onCount={(target, count) => perform(setCount(target, count))}
          onWrapper={wrap}
          onAuthorNote={(authorNote) => update(() => ({ authorNote }))}
          onMark={mark}
          cache={marks.get(block.id)}
          onCache={() => cacheAt(block.id)}
          onMove={(to) => move(index, to)}
          onRemove={() => remove(block.id)}
          onCondition={(toggle) => typeSnippet((selected) => conditionSnippet(toggle, selected))}
          onInsert={(snippet) => typeSnippet(() => snippet)}
          onNewToggle={() => {
            setAddingToggle(true);
            pick(TOGGLES);
          }}
          textRef={textRef}
          nameRef={nameRef}
        />
      )
    );

  if (!split && drilled) {
    const title = open === MODEL ? '모델' : open === TOGGLES ? '토글' : block ? blockTitle(block).title : '';
    return frame({ head: { title, onBack: leavePage, backLabel: '보내는 순서', status: SAVE_STATUS[save.status ?? 'saved'] }, body: page, open });
  }

  const origin = stored.value.task === undefined && stored.value.imported === 'risu-preset' ? 'Risu 프리셋에서 가져옴' : stored.value.origin ? `‘${promptName(stored.value.origin.name)}’의 사본` : null;
  const subtitle = (
    <>
      {isDefault && <Tag tone="accent">{words.default}</Tag>}
      <span>{[sort === 'conversation' && (uses.chats ? `채팅 ${uses.chats}개가 쓰는 중` : '쓰는 채팅 없음'), origin].filter(Boolean).join(' · ')}</span>
    </>
  );
  const more = (
    <Menu label="프롬프트 더 보기" place="below-end" trigger={(opener) => <IconButton icon={Ellipsis} label="프롬프트 더 보기" title="더 보기" {...opener} />}>
      {!split && <MenuItem icon={Copy} label="사본 만들기" onClick={() => void copy()} />}
      {!isDefault && <MenuItem label="기본으로 정하기" sub={words.makeDefault} onClick={() => void makeDefault()} />}
      <MenuItem label="지우기" tone="warn" onClick={() => void erase()} />
    </Menu>
  );
  const head: NavBarProps = {
    title: draft.name,
    rename: { label: '프롬프트 이름', placeholder: promptName(''), onChange: (name) => update(() => ({ name })) },
    subtitle,
    onBack,
    backLabel,
    status: SAVE_STATUS[save.status ?? 'saved'],
    actions: (
      <>
        {split && (
          <Button variant="secondary" size="sm" icon={Copy} onClick={() => void copy()}>
            사본 만들기
          </Button>
        )}
        {more}
      </>
    ),
  };

  if (split) return frame({ head, side: outline, body: page, open });
  return frame({ head, body: <Stack gap="section">{outline}</Stack>, open });
}
