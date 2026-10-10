import { importTool, undoToolImport } from '../../runtime/tools/store';
import { useToast } from '../toast';
import { Check, MessageSquare, MessageSquarePlus, Package } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ImportFailure } from '../../engine/import/types';
import { characterTexts, live } from '../../model/library';
import { EMPTY_SETTINGS } from '../../model/settings';
import { importCharacter } from '../../runtime/characters';
import { importChat } from '../../runtime/chat-log';
import type { ApiFailure } from '../../runtime/api';
import { ImportWorker } from '../../runtime/import/client';
import { ImportReadError, type ChatsRead } from '../../runtime/import/protocol';
import { importModule, setModuleAt, type ModulePlace } from '../../runtime/modules';
import { fillPictures, importRisuChats, risuMatch } from '../../runtime/move';
import { ofSort } from '../../runtime/prompts';
import type { ObjectStore } from '../../runtime/store';
import { aliased } from '../common/alias';
import { describeFailure } from '../common/failure';
import { useSearch } from '../common/useSearch';
import { NO_CHARACTER } from '../common/words';
import { useFiles, useLibrary, useSettings, useStore } from '../session';
import { navigate, useRoute } from '../shell/router';
import type { Route } from '../shell/routes';
import { Avatar, Button, Callout, ChipButton, ConfirmDialog, Dialog, DropOverlay, Empty, Menu, MenuItem, Progress, Row, Section, Stack, Text, useFileDrop, type ProgressStep } from '../ui';
import { characterOutcome, chatOutcome, moduleOutcome, toolOutcome, type ImportOutcome } from './importOutcome';
import { assetsMissed, chatMissed, moveMissed } from './missed';
import { MoveDialog } from './MoveDialog';
import { MoveFlow } from './MoveFlow';
import { stepOf } from './saving';

const ACCEPT = '.png,.charx,.jpg,.jpeg,.json,.risum,.bin,.js';

type Filled = { kind: 'filled'; file: string; name: string; kept: number; missed: string[] };
type Result = ImportOutcome | Filled | { kind: 'failed'; file: string; failure: string };
// fill: whether to bring only a card's pictures to the character Risu's move brought under its name. character: which
// character a file of chats goes to, null for 캐릭터 없이; name is the one the file was with, when it says.
type Ask = { kind: 'fill'; name: string; answer: (fill: boolean) => void } | { kind: 'character'; file: string; name: string | null; fallback: string | null; answer: (character: string | null) => void };
// Where a file of chats goes: a character's id, null for 캐릭터 없이, undefined where the way in names none.
type Target = string | null | undefined;
type State = { busy: { file: string; steps: ProgressStep[] } | null; results: Result[]; ask: Ask | null };

const ImportContext = createContext<{ pick: () => void; pickChats: (target: string | null) => void; move: () => void } | null>(null);

export function useImport() {
  const context = useContext(ImportContext);
  if (!context) throw new Error('useImport outside ImportProvider');
  return context;
}

const FAILURE: Record<ImportFailure['kind'], string> = {
  'unknown-format': '가져올 수 없는 형식이에요.',
  encrypted: '암호화된 카드라 열 수 없어요.',
  unreadable: '파일을 읽지 못했어요.',
};

// Keyed by engine/import/tool's failure details; a detail missing here reads as 파일을 읽지 못했어요.
const TOOL_FAILURE: Record<string, string> = {
  'tool-too-large': '도구 파일이 너무 커요.',
  'tool-encoding': 'UTF-8 텍스트 파일이 아니에요.',
  'tool-api': '헤이젤 도구 파일이 아니에요. 맨 위에 //@api 1이 있어야 해요.',
  'tool-identity': '//@name과 //@author가 있어야 하고, 글자, 숫자, _ . -로만 쓸 수 있어요.',
  'tool-setting': '설정 줄을 읽지 못했어요.',
  'tool-menu': '메뉴 줄을 읽지 못했어요.',
  'tool-action': '메시지 동작 줄을 읽지 못했어요.',
  'tool-composer': '입력창 줄을 읽지 못했어요.',
  'tool-uses': '//@uses에는 model, embed, memory만 쓸 수 있어요.',
  'tool-unknown': '알 수 없는 줄이에요.',
};

const unsaved = (file: string, failure: ApiFailure): Result => ({ kind: 'failed', file, failure: `저장하지 못했어요. ${describeFailure(failure)}` });

function describeImportFailure({ kind, detail, line }: ImportFailure): string {
  const tool = detail && TOOL_FAILURE[detail];
  if (!tool) return FAILURE[kind];
  return line ? `${tool} ${line}` : tool;
}

// Where a module dropped or picked on this route is turned on first (design §6.5): a character's page, editor or chat,
// a conversation prompt's editor, or 설정 › 모듈 for 항상. A file of chats that names no character goes to the character found here too.
function placeOf(store: ObjectStore, route: Route): ModulePlace | null {
  switch (route.kind) {
    case 'shelf':
    case 'new-chat':
      return route.character === null ? null : { kind: 'character', id: route.character };
    case 'edit':
      return { kind: 'character', id: route.character };
    case 'chat': {
      const character = store.get('chat', route.id)?.value.character ?? null;
      return character === null ? null : { kind: 'character', id: character };
    }
    case 'prompt': {
      const prompt = live(store.get('prompt', route.id));
      return prompt && ofSort(prompt, 'conversation') ? { kind: 'prompt', prompt } : null;
    }
    case 'modules':
    case 'module':
    case 'tool-page':
      return { kind: 'always' };
    default:
      return null;
  }
}

// Risu backups (.bin) go to MoveFlow together, and a card named like a character brought from Risu may only fill that
// character's pictures. Every way in asks once per account for the RisuAI-only notice first: Risu cards carry no such
// mark (their license field is Creative Commons only), so the notice cannot be shown per card.
export function ImportProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const files = useFiles();
  const toast = useToast();
  const route = useRoute();
  const noticed = useSettings().importNotice === true;
  const [notice, setNotice] = useState<(() => void) | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<Target>(undefined);
  const readers = useRef(new Set<ImportWorker>());
  const mounted = useRef(true);
  const [state, setState] = useState<State | null>(null);
  const [moving, setMoving] = useState<{ files: File[]; aside: number } | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const reader of readers.current) reader.close();
      readers.current.clear();
    };
  }, []);

  // A file of chats goes where the way in named, else to the character it was with when that one is here. When that
  // one is gone, the user picks, with a character of the same name picked first. A file that names none goes to the
  // route's character, else where the user picks.
  async function saveChats(file: string, read: ChatsRead, target: Target, place: ModulePlace | null, choose: (name: string | null, fallback: string | null) => Promise<string | null>): Promise<Result> {
    const named = 'chat' in read ? read.chat.character : null;
    const routed = place?.kind === 'character' && live(store.get('character', place.id)) ? place.id : null;
    const character =
      target !== undefined ? target : named === null ? (routed ?? (await choose(null, null))) : live(store.get('character', named.id)) ? named.id : await choose(named.name, routed);
    const shown = character === null ? null : store.get('character', character)!.value;
    const name = shown && aliased(shown.card.name, shown.alias);
    if ('chat' in read) {
      const saved = await importChat({ store, files }, read.chat, character);
      return saved.ok ? chatOutcome(file, [saved.data.id], name, chatMissed(saved.data.dropped)) : unsaved(file, saved);
    }
    const saved = await importRisuChats(store, character, read.risuChats);
    return saved.ok ? chatOutcome(file, saved.data, name, moveMissed(read.missed)) : unsaved(file, saved);
  }

  async function save(file: File, place: ModulePlace | null, target: Target, progress: (step: ProgressStep) => void, ask: (name: string) => Promise<boolean>, choose: (name: string | null, fallback: string | null) => Promise<string | null>): Promise<Result> {
    const reader = new ImportWorker();
    readers.current.add(reader);
    try {
      const parsed = await reader.card(file);
      if (!parsed.ok) return { kind: 'failed', file: file.name, failure: describeImportFailure(parsed.failure) };
      if ('chat' in parsed || 'risuChats' in parsed) return await saveChats(file.name, parsed, target, place, choose);
      if ('tool' in parsed) {
        const saved = await importTool(store, files, parsed.tool);
        if (!saved.ok) return unsaved(file.name, saved);
        const previous = saved.data.previous;
        const placed = !previous && place && (await setModuleAt(store, place, saved.data.id, true));
        const outcome = toolOutcome(file.name, parsed.tool.manifest, saved.data, { at: place?.kind ?? null, failure: placed && !placed.ok ? describeFailure(placed) : null });
        if (previous) toast.undoable(outcome.holds, () => undoToolImport(store, saved.data.id, previous));
        return outcome;
      }
      if ('module' in parsed) {
        const saved = await importModule(store, files, parsed.module, (step) => progress(stepOf(step)));
        if (!saved.ok) return unsaved(file.name, saved);
        const placed = place && (await setModuleAt(store, place, saved.data.id, true));
        const failure = placed && !placed.ok ? describeFailure(placed) : null;
        return moduleOutcome(file.name, parsed.module, saved.data.id, saved.data.skipped, { at: place?.kind ?? null, failure });
      }
      const { name } = parsed.card.card;
      const match = parsed.card.assets.length > 0 ? risuMatch(store, name) : null;
      if (match !== null && (await ask(name))) {
        progress(stepOf({ kind: 'picture' }));
        const filled = await fillPictures(store, files, match, parsed.card.assets);
        if (!filled.ok) return unsaved(file.name, filled);
        return { kind: 'filled', file: file.name, name, kept: filled.data.kept, missed: assetsMissed(parsed.card.report, filled.data.skipped) };
      }
      const saved = await importCharacter(store, files, parsed.card, parsed.card.avatar, (step) => progress(stepOf(step)));
      if (!saved.ok) return unsaved(file.name, saved);
      return characterOutcome(file.name, parsed.card, saved.data);
    } catch (error) {
      if (!(error instanceof ImportReadError)) throw error;
      return { kind: 'failed', file: file.name, failure: '파일을 읽지 못했어요. 다시 가져와 주세요.' };
    } finally {
      reader.close();
      readers.current.delete(reader);
    }
  }

  async function take(files: File[], target: Target) {
    if (files.length === 0 || state?.busy || moving) return;
    const backups = files.filter((file) => file.name.toLowerCase().endsWith('.bin'));
    if (backups.length > 0) return setMoving({ files: backups, aside: files.length - backups.length });
    const place = placeOf(store, route);
    const results: Result[] = [];
    for (const file of files) {
      if (!mounted.current) return;
      setState({ busy: { file: file.name, steps: [] }, results, ask: null });
      const progress = (step: ProgressStep) => setState({ busy: { file: file.name, steps: [step] }, results, ask: null });
      const ask = (name: string) => new Promise<boolean>((answer) => setState({ busy: { file: file.name, steps: [] }, results, ask: { kind: 'fill', name, answer } }));
      const choose = (name: string | null, fallback: string | null) => new Promise<string | null>((answer) => setState({ busy: { file: file.name, steps: [] }, results, ask: { kind: 'character', file: file.name, name, fallback, answer } }));
      results.push(await save(file, place, target, progress, ask, choose));
    }
    setState({ busy: null, results, ask: null });
  }

  // then runs inside the confirming press, so a file picker it opens still counts as the user's own.
  function asked(then: () => void) {
    if (noticed) then();
    else setNotice(() => then);
  }

  function open(to: Target) {
    asked(() => {
      target.current = to;
      input.current?.click();
    });
  }

  const dragging = useFileDrop((dropped) => asked(() => void take(dropped, undefined)));

  const done = state?.results.flatMap((result) => result.kind === 'character' ? [result.id] : []) ?? [];
  const chats = state?.results.flatMap((result) => result.kind === 'chat' ? [result.id] : []) ?? [];
  const modules = state?.results.flatMap((result) => result.kind === 'module' ? [result.id] : []) ?? [];
  const go = (to: Route) => {
    setState(null);
    navigate(to);
  };
  const came = state?.results.some((result) => result.kind !== 'failed') ?? false;
  const title = state?.ask ? (state.ask.kind === 'fill' ? '이미지만 가져올까요?' : '어느 캐릭터에 넣을까요?') : state?.busy ? '가져오는 중' : came ? '가져왔어요' : '가져오지 못했어요';
  return (
    <ImportContext.Provider value={{ pick: () => open(undefined), pickChats: open, move: () => asked(() => setAsking(true)) }}>
      {children}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          void take(files, target.current);
        }}
      />
      {notice && (
        <ConfirmDialog
          title="가져오기 전에 확인해 주세요"
          confirm="확인했어요"
          icon={Check}
          onConfirm={() => {
            setNotice(null);
            void store.upsert('settings', (current = EMPTY_SETTINGS) => ({ ...current, importNotice: true }));
            notice();
          }}
          onClose={() => setNotice(null)}
        >
          제작자가 RisuAI에서만 쓰도록 배포한 봇은 가져오지 마세요.
        </ConfirmDialog>
      )}
      {dragging && <DropOverlay>여기에 놓으면 봇, 모듈, 채팅이나 Risu 백업을 가져와요</DropOverlay>}
      {asking && (
        <MoveDialog
          onRead={(files) => {
            setAsking(false);
            setMoving({ files, aside: 0 });
          }}
          onClose={() => setAsking(false)}
        />
      )}
      {moving && <MoveFlow files={moving.files} aside={moving.aside} onClose={() => setMoving(null)} />}
      {state && (
        <Dialog title={title} onClose={() => state.busy || setState(null)}>
          <Stack>
            {state.results.map((result, index) =>
              result.kind === 'failed' ? <Failed key={index} file={result.file} failure={result.failure} /> : result.kind === 'filled' ? <FilledSummary key={index} result={result} /> : <Summary key={index} result={result} />,
            )}
            {state.ask?.kind === 'fill' ? <FillChoice ask={state.ask} onAnswer={() => setState({ ...state, ask: null })} /> : state.ask ? <CharacterChoice key={state.ask.file} ask={state.ask} onAnswer={() => setState({ ...state, ask: null })} /> : state.busy && <><Text variant="note">{state.busy.file}</Text><Progress steps={state.busy.steps} /></>}
            {!state.busy && done.length === 1 && (
              <Button
                icon={MessageSquarePlus}
                onClick={() => go({ kind: 'new-chat', character: done[0]! })}
              >
                채팅 시작
              </Button>
            )}
            {!state.busy && chats.length === 1 && chats[0] !== null && (
              <Button
                variant={done.length === 1 ? 'secondary' : 'primary'}
                icon={MessageSquare}
                onClick={() => go({ kind: 'chat', id: chats[0]! })}
              >
                열기
              </Button>
            )}
            {!state.busy && modules.length === 1 && (
              <Button
                variant={done.length === 1 ? 'secondary' : 'primary'}
                icon={Package}
                onClick={() => go({ kind: 'module', id: modules[0]! })}
              >
                모듈 보기
              </Button>
            )}
          </Stack>
        </Dialog>
      )}
    </ImportContext.Provider>
  );
}

function Summary({ result }: { result: ImportOutcome }) {
  return (
    <Section level={3} title={result.title}>
      <Text>{result.holds}</Text>
      {result.placed && (result.placed.failed ? <Callout tone="warn">{result.placed.text}</Callout> : <Text>{result.placed.text}</Text>)}
      {result.missed.length > 0 && <Callout tone="warn">못 가져온 것: {result.missed.join(' · ')}</Callout>}
      {result.unused && <Text variant="note">{result.unused}</Text>}
    </Section>
  );
}

function CharacterChoice({ ask, onAnswer }: { ask: Extract<Ask, { kind: 'character' }>; onAnswer: () => void }) {
  const { characters } = useLibrary();
  const [picked, setPicked] = useState(() => characters.find(({ character }) => character.card.name === ask.name)?.id ?? ask.fallback);
  const search = useSearch(characters, '캐릭터 검색', ({ character }) => characterTexts(character));
  const chosen = characters.find(({ id }) => id === picked)?.character;
  const name = chosen ? aliased(chosen.card.name, chosen.alias) : NO_CHARACTER;
  return (
    <Section level={3} title={ask.name ?? ask.file}>
      <Stack gap="related">
        <Menu place="below-start" size="lg" label="캐릭터" trigger={(opener) => <ChipButton variant="field" label={name} title="캐릭터" {...opener} />}>
          {search.field}
          {search.none && <Empty variant="menu">{search.none}</Empty>}
          {!search.words && <MenuItem label={NO_CHARACTER} checked={picked === null} onClick={() => setPicked(null)} />}
          {search.found.map(({ id, character, face }) => (
            <MenuItem key={id} label={aliased(character.card.name, character.alias)} avatar={<Avatar face={character.card.name} image={face} />} checked={picked === id} onClick={() => setPicked(id)} />
          ))}
        </Menu>
        <Row kind="actions">
          <Button
            size="md"
            onClick={() => {
              onAnswer();
              ask.answer(picked);
            }}
          >
            넣기
          </Button>
        </Row>
      </Stack>
    </Section>
  );
}

function FillChoice({ ask, onAnswer }: { ask: Extract<Ask, { kind: 'fill' }>; onAnswer: () => void }) {
  const answer = (fill: boolean) => {
    onAnswer();
    ask.answer(fill);
  };
  return (
    <Section level={3} title={ask.name} help="기존 캐릭터의 대화와 설정은 두고 이미지만 이 카드에서 가져와요.">
      <Stack gap="related">
        <Text>Risu에서 가져온 같은 이름의 캐릭터가 있어요.</Text>
        <Row kind="actions">
          <Button variant="secondary" size="md" onClick={() => answer(false)}>
            새 캐릭터로 가져오기
          </Button>
          <Button size="md" onClick={() => answer(true)}>
            이미지만 가져오기
          </Button>
        </Row>
      </Stack>
    </Section>
  );
}

function FilledSummary({ result }: { result: Filled }) {
  return (
    <Section level={3} title={result.name}>
      <Text>{`이미지 ${result.kept}개를 가져왔어요`}</Text>
      {result.missed.length > 0 && <Callout tone="warn">못 가져온 것: {result.missed.join(' · ')}</Callout>}
    </Section>
  );
}

function Failed({ file, failure }: { file: string; failure: string }) {
  return (
    <Section level={3} title={file}>
      <Callout tone="warn">{failure}</Callout>
    </Section>
  );
}
