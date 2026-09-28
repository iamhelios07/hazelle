import { MessageSquarePlus } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { importCard } from '../../engine/import/card';
import type { Imported, ImportFailure, UnsupportedKind } from '../../engine/import/types';
import { addCharacter } from '../../runtime/library';
import { unused } from '../../engine/prompt';
import { navigate } from '../router';
import { useFiles, useStore } from '../session';
import { Button, Callout, Dialog, DropOverlay, Section, Stack, Text } from '../ui';
import { describeFailure } from './failure';
import { describeStep } from './saving';
import { newChatPath } from './shelves';
import { describeUnused } from './unused';

const ACCEPT = '.png,.charx,.jpg,.jpeg,.json,.risum';
// The longest side of the thumbnail that lists and 캐릭터 둘러보기 show; the original stays in its blob.
const THUMB = 400;

type Done = { file: string; id: string; imported: Imported; faceless: boolean; lore: number };
type Result = Done | { file: string; failure: string };
type State = { busy: string | null; results: Result[] };

const ImportContext = createContext<{ pick: () => void } | null>(null);

export function useImport() {
  const context = useContext(ImportContext);
  if (!context) throw new Error('useImport outside ImportProvider');
  return context;
}

const UNSUPPORTED: Record<UnsupportedKind, (count: number) => string> = {
  trigger: (count) => `트리거 ${count}개`,
  lua: (count) => `Lua 트리거 ${count}개`,
  asset: (count) => `에셋 ${count}개`,
  'background-html': () => '배경 HTML',
  'additional-text': () => '추가 설명(임베딩)',
  'prebuilt-asset-command': () => '에셋 명령',
  'depth-prompt': () => '깊이 프롬프트',
  'disable-ui-prompt': (count) => `@@disable_ui_prompt ${count}곳`,
  'cbs-tag': (count) => `지원하지 않는 CBS 태그 ${count}개`,
  'regex-stage': (count) => `지원하지 않는 단계의 정규식 ${count}개`,
  module: () => '읽지 못한 모듈',
};

const FAILURE: Record<ImportFailure['kind'], string> = {
  'unknown-format': '이 형식은 가져올 수 없어요. PNG · charx · JSON 캐릭터 카드만 돼요.',
  'module-file': '.risum 모듈은 아직 따로 가져올 수 없어요. 모듈이 든 charx는 가져올 수 있어요.',
  encrypted: '암호화된 카드라 열 수 없어요.',
  unreadable: '파일을 읽지 못했어요. 깨졌거나 캐릭터 카드가 아니에요.',
};

// A small copy of the picture for lists. Safari cannot write WebP and hands back PNG, which is far
// larger, so it gets JPEG instead.
async function thumbnail({ bytes, type }: { bytes: Uint8Array<ArrayBuffer>; type: string }): Promise<string> {
  const bitmap = await createImageBitmap(new Blob([bytes], { type }));
  const scale = Math.min(1, THUMB / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.82 });
  if (blob.type !== 'image/webp') blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Bot import (design F2): pick or drop files anywhere, each is saved as a character, and a summary
// says what came in, what did not, and what its chats do not use yet.
export function ImportProvider({ children }: { children: ReactNode }) {
  const store = useStore();
  const files = useFiles();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State | null>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  async function save(file: File, progress: (busy: string) => void): Promise<Result> {
    const parsed = importCard(file.name, new Uint8Array(await file.arrayBuffer()));
    if (!parsed.ok) return { file: file.name, failure: FAILURE[parsed.failure.kind] };
    const { card, avatar } = parsed.card;
    const loreFolders = parsed.card.loreFolders.map((name) => ({ id: crypto.randomUUID(), name }));
    const lore = parsed.card.lore.map((entry) => ({ ...entry, folder: entry.folder === null ? null : loreFolders[entry.folder]!.id }));
    const thumb = avatar ? await thumbnail(avatar).catch(() => null) : null;
    const picture = avatar && thumb !== null ? { ...avatar, thumb } : null;
    const saved = await addCharacter(store, files, { card, folder: null, loreFolders }, lore, picture, (step) => progress(describeStep(step)));
    if (!saved.ok) return { file: file.name, failure: `저장하지 못했어요. ${describeFailure(saved)}` };
    return { file: file.name, id: saved.data, imported: parsed.card, faceless: avatar !== null && thumb === null, lore: lore.length };
  }

  async function take(files: File[]) {
    if (files.length === 0 || state?.busy) return;
    const results: Result[] = [];
    for (const file of files) {
      setState({ busy: file.name, results });
      results.push(await save(file, (busy) => setState({ busy: `${file.name} · ${busy}`, results })));
    }
    setState({ busy: null, results });
  }

  // Files dropped anywhere in the app. dragenter and dragleave fire for every element crossed, so
  // the overlay counts them instead of trusting either one.
  useEffect(() => {
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth.current += 1;
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const over = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      void take([...(event.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  });

  const done = state?.results.filter((result): result is Done => 'id' in result) ?? [];
  return (
    <ImportContext.Provider value={{ pick: () => input.current?.click() }}>
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
      {dragging && <DropOverlay>여기에 놓으면 봇을 가져와요</DropOverlay>}
      {state && (
        <Dialog title={state.busy ? '가져오는 중' : done.length ? '가져왔어요' : '가져오지 못했어요'} onClose={() => state.busy || setState(null)}>
          <Stack gap={16}>
            {state.results.map((result, index) => ('id' in result ? <Summary key={index} result={result} /> : <Failed key={index} file={result.file} failure={result.failure} />))}
            {state.busy && <Text tone="muted">{state.busy}</Text>}
            {!state.busy && done.length === 1 && (
              <Button
                icon={MessageSquarePlus}
                onClick={() => {
                  setState(null);
                  navigate(newChatPath(done[0]!.id));
                }}
              >
                채팅 시작
              </Button>
            )}
          </Stack>
        </Dialog>
      )}
    </ImportContext.Provider>
  );
}

function Summary({ result }: { result: Done }) {
  const { card, report } = result.imported;
  const came = [
    `첫인사 ${card.greetings.length}개`,
    result.lore > 0 && `로어북 ${result.lore}개`,
    card.regex.length > 0 && `정규식 ${card.regex.length}개`,
    card.variables.length > 0 && `기본 변수 ${card.variables.length}개`,
    card.toggles.trim() && '토글',
  ].filter(Boolean);
  const missed = report.unsupported.map((item) => UNSUPPORTED[item.kind](item.count));
  if (result.faceless) missed.unshift('그림: 읽지 못함');
  const notUsed = describeUnused(unused(card, result.lore));
  return (
    <Section title={card.name}>
      <Text>{came.join(' · ')}</Text>
      {missed.length > 0 && <Callout tone="warn">못 가져온 것: {missed.join(' · ')}</Callout>}
      {notUsed && <Text tone="muted">{notUsed}</Text>}
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
