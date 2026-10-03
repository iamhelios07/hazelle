import { MessageSquarePlus, Package } from 'lucide-react';
import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import { importCard } from '../../engine/import/card';
import type { ImportFailure } from '../../engine/import/types';
import { importCharacter } from '../../runtime/characters';
import { importModule } from '../../runtime/modules';
import { fillPictures, risuMatch } from '../../runtime/move';
import { thumbnail } from '../../runtime/picture';
import { describeFailure } from '../common/failure';
import { useFiles, useStore } from '../session';
import { navigate } from '../shell/router';
import { Button, Callout, Dialog, DropOverlay, Row, Section, Stack, Text, useFileDrop } from '../ui';
import { characterOutcome, moduleOutcome, type ImportOutcome } from './importOutcome';
import { assetsMissed } from './missed';
import { MoveDialog } from './MoveDialog';
import { MoveFlow } from './MoveFlow';
import { describeStep } from './saving';

const ACCEPT = '.png,.charx,.jpg,.jpeg,.json,.risum,.bin';

// A card whose name matches a character brought from Risu, put into that character's bot pictures.
type Filled = { kind: 'filled'; file: string; name: string; kept: number; missed: string[] };
type Result = ImportOutcome | Filled | { kind: 'failed'; file: string; failure: string };
type Ask = { name: string; answer: (fill: boolean) => void };
type State = { busy: string | null; results: Result[]; ask: Ask | null };

// pick opens the file picker of 봇 가져오기; move opens Risu에서 이사.
const ImportContext = createContext<{ pick: () => void; move: () => void } | null>(null);

export function useImport() {
  const context = useContext(ImportContext);
  if (!context) throw new Error('useImport outside ImportProvider');
  return context;
}

const FAILURE: Record<ImportFailure['kind'], string> = {
  'unknown-format': '이 형식은 가져올 수 없어요. PNG · charx · JSON 캐릭터 카드, 모듈(.risum)과 Risu 백업(.bin)만 돼요.',
  encrypted: '암호화된 카드라 열 수 없어요.',
  unreadable: '파일을 읽지 못했어요. 깨졌거나 캐릭터 카드나 모듈이 아니에요.',
};

// Bot import: pick or drop files anywhere, each is saved as a character or a module, and a summary says what came in, what did
// not, and what its chats do not use yet. Risu backups (.bin) go to MoveFlow together, and a card named like a
// character brought from Risu may only fill that character's pictures.
export function ImportProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const files = useFiles();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State | null>(null);
  const [moving, setMoving] = useState<{ files: File[]; aside: number } | null>(null);
  const [asking, setAsking] = useState(false);

  async function save(file: File, progress: (busy: string) => void, ask: (name: string) => Promise<boolean>): Promise<Result> {
    const parsed = importCard(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!parsed.ok) return { kind: 'failed', file: file.name, failure: FAILURE[parsed.failure.kind] };
    if ('module' in parsed) {
      const saved = await importModule(store, files, parsed.module, (step) => progress(describeStep(step)));
      if (!saved.ok) return { kind: 'failed', file: file.name, failure: `저장하지 못했어요. ${describeFailure(saved)}` };
      return moduleOutcome(file.name, parsed.module, saved.data.id, saved.data.skipped);
    }
    const { name } = parsed.card.card;
    const match = parsed.card.assets.length > 0 ? risuMatch(store, name) : null;
    if (match !== null && (await ask(name))) {
      progress('그림 올리는 중');
      const filled = await fillPictures(store, files, match, parsed.card.assets);
      if (!filled.ok) return { kind: 'failed', file: file.name, failure: `저장하지 못했어요. ${describeFailure(filled)}` };
      return { kind: 'filled', file: file.name, name, kept: filled.data.kept, missed: assetsMissed(parsed.card.report, filled.data.skipped) };
    }
    const { avatar } = parsed.card;
    const thumb = avatar ? await thumbnail(avatar).catch(() => null) : null;
    const picture = avatar && thumb !== null ? { ...avatar, thumb } : null;
    const saved = await importCharacter(store, files, parsed.card, picture, (step) => progress(describeStep(step)));
    if (!saved.ok) return { kind: 'failed', file: file.name, failure: `저장하지 못했어요. ${describeFailure(saved)}` };
    return characterOutcome(file.name, parsed.card, { ...saved.data, faceless: saved.data.faceless || (avatar !== null && thumb === null) });
  }

  async function take(files: File[]) {
    if (files.length === 0 || state?.busy || moving) return;
    const backups = files.filter((file) => file.name.toLowerCase().endsWith('.bin'));
    if (backups.length > 0) return setMoving({ files: backups, aside: files.length - backups.length });
    const results: Result[] = [];
    for (const file of files) {
      setState({ busy: file.name, results, ask: null });
      const progress = (busy: string) => setState({ busy: `${file.name} · ${busy}`, results, ask: null });
      const ask = (name: string) => new Promise<boolean>((answer) => setState({ busy: file.name, results, ask: { name, answer } }));
      results.push(await save(file, progress, ask));
    }
    setState({ busy: null, results, ask: null });
  }

  const dragging = useFileDrop((dropped) => void take(dropped));

  const done = state?.results.flatMap((result) => result.kind === 'character' ? [result.id] : []) ?? [];
  const modules = state?.results.flatMap((result) => result.kind === 'module' ? [result.id] : []) ?? [];
  const came = state?.results.some((result) => result.kind !== 'failed') ?? false;
  const title = state?.ask ? '그림만 채울까요?' : state?.busy ? '가져오는 중' : came ? '가져왔어요' : '가져오지 못했어요';
  return (
    <ImportContext.Provider value={{ pick: () => input.current?.click(), move: () => setAsking(true) }}>
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
          void take(files);
        }}
      />
      {dragging && <DropOverlay>여기에 놓으면 봇, 모듈이나 Risu 백업을 가져와요</DropOverlay>}
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
            {state.ask ? <FillChoice ask={state.ask} onAnswer={() => setState({ ...state, ask: null })} /> : state.busy && <Text variant="note">{state.busy}</Text>}
            {!state.busy && done.length === 1 && (
              <Button
                icon={MessageSquarePlus}
                onClick={() => {
                  setState(null);
                  navigate({ kind: 'new-chat', character: done[0]! });
                }}
              >
                채팅 시작
              </Button>
            )}
            {!state.busy && modules.length === 1 && (
              <Button
                variant={done.length === 1 ? 'secondary' : 'primary'}
                icon={Package}
                onClick={() => {
                  setState(null);
                  navigate({ kind: 'module', id: modules[0]! });
                }}
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
    <Section title={result.title}>
      <Text>{result.holds}</Text>
      {result.missed.length > 0 && <Callout tone="warn">못 가져온 것: {result.missed.join(' · ')}</Callout>}
      {result.unused && <Text variant="note">{result.unused}</Text>}
    </Section>
  );
}

function FillChoice({ ask, onAnswer }: { ask: Ask; onAnswer: () => void }) {
  const answer = (fill: boolean) => {
    onAnswer();
    ask.answer(fill);
  };
  return (
    <Section title={ask.name} hint="그림만 채우면 그 캐릭터의 대화와 설정은 그대로 두고, 봇 그림만 이 카드에서 채워요.">
      <Stack gap="related">
        <Text>Risu에서 가져온 같은 이름의 캐릭터가 있어요.</Text>
        <Row kind="actions">
          <Button variant="secondary" size="md" onClick={() => answer(false)}>
            새 캐릭터로 가져오기
          </Button>
          <Button size="md" onClick={() => answer(true)}>
            그림만 채우기
          </Button>
        </Row>
      </Stack>
    </Section>
  );
}

function FilledSummary({ result }: { result: Filled }) {
  return (
    <Section title={result.name}>
      <Text>{`그림 ${result.kept}개를 채웠어요`}</Text>
      {result.missed.length > 0 && <Callout tone="warn">못 가져온 것: {result.missed.join(' · ')}</Callout>}
    </Section>
  );
}

function Failed({ file, failure }: { file: string; failure: string }) {
  return (
    <Section title={file}>
      <Callout tone="warn">{failure}</Callout>
    </Section>
  );
}
