import { useState, type ReactNode } from 'react';
import type { PresetFailure, PresetUnsupported, PresetUnsupportedKind } from '../../engine/import/preset';
import { isToggle, type ConversationPrompt } from '../../model/prompt';
import { importPrompt, ofSort } from '../../runtime/prompts';
import type { ObjectStore } from '../../runtime/store';
import { describeFailure } from '../common/failure';
import { inSettings, promptName } from '../common/words';
import { useStore } from '../session';
import { Button, Callout, Dialog, DropOverlay, Outcome, Section, Stack, Text, useFileDrop } from '../ui';

const FAILURE: Record<PresetFailure['kind'], string> = {
  unreadable: '파일을 읽지 못했어요. 깨졌거나 Risu 프리셋(.risup, .risupreset)이 아니에요.',
  'not-preset': 'Risu 파일이지만 프리셋이 아니에요.',
  'decrypt-failed': '프리셋을 열지 못했어요. 파일이 깨졌을 수 있어요.',
  'no-template': '프롬프트 템플릿을 쓰지 않는 프리셋은 가져올 수 없어요. Risu에서 템플릿을 켜고 다시 내보내 주세요.',
};

const UNSUPPORTED: Record<PresetUnsupportedKind, (count: number) => { title: string; note?: string }> = {
  jailbreak: (count) => ({ title: `탈옥 블록 ${count}개` }),
  cot: (count) => ({ title: `추론 유도(CoT) 블록 ${count}개` }),
  chatml: (count) => ({ title: `ChatML 블록 ${count}개` }),
  'cache-narrowed': (count) => ({ title: `바꿔서 가져온 캐시 지점 ${count}개`, note: '메시지 하나에 두는 지점으로 바꿨어요.' }),
  'unread-item': (count) => ({ title: `읽지 못한 블록 ${count}개` }),
  'repeated-slot': (count) => ({ title: `중복된 블록 ${count}개`, note: '처음 것만 가져왔어요.' }),
  'toggle-line': (count) => ({ title: `읽지 못한 토글 줄 ${count}개` }),
  'preset-text': (count) => ({ title: `템플릿 밖의 텍스트 ${count}개`, note: 'Risu에서도 보내지 않던 텍스트예요.' }),
  regex: (count) => ({ title: `정규식 ${count}개` }),
  variables: (count) => ({ title: `기본 변수 ${count}개` }),
  settings: () => ({ title: '모델과 생성 설정', note: `모델 설정은 ${inSettings('models')}에서 해요.` }),
};

type Opened = { file: string; id: string; prompt: ConversationPrompt; unsupported: PresetUnsupported[] };
type Result = Opened | { file: string; failure: string };

export async function readPreset(store: ObjectStore, file: File): Promise<Result> {
  // A folder dropped here, or a file moved since it was picked, cannot be read.
  const bytes = await file.arrayBuffer().catch(() => null);
  if (!bytes) return { file: file.name, failure: FAILURE.unreadable };
  const imported = await importPrompt(store, file.name, new Uint8Array(bytes));
  if (!imported.ok) {
    const { failure } = imported;
    return { file: file.name, failure: failure.kind === 'save' ? `저장하지 못했어요. ${describeFailure(failure.failure)}` : FAILURE[failure.kind] };
  }
  const prompt = store.get('prompt', imported.id);
  return prompt && ofSort(prompt, 'conversation') ? { file: file.name, id: imported.id, prompt: prompt.value, unsupported: imported.unsupported } : { file: file.name, failure: '다른 곳에서 삭제됐어요.' };
}

// While the list is open, its drop takes files from the app's character import.
export function usePresetImport(onOpen: (id: string) => void): { take: (files: File[]) => void; view: ReactNode } {
  const store = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);

  async function take(files: File[]) {
    if (files.length === 0 || busy) return;
    const done: Result[] = [];
    for (const file of files) {
      setBusy(file.name);
      done.push(await readPreset(store, file));
    }
    setBusy(null);
    setResults(done);
  }

  const dragging = useFileDrop((files) => void take(files), 'screen');
  const opened = (results ?? []).filter((result): result is Opened => 'id' in result);
  const only = opened.length === 1 ? opened[0] : undefined;
  const view = (
    <>
      {dragging && <DropOverlay>여기에 놓으면 새 프롬프트로 가져와요</DropOverlay>}
      {busy && (
        <Dialog title="가져오는 중" onClose={() => {}}>
          <Text variant="note">{busy}</Text>
        </Dialog>
      )}
      {results && (
        <Dialog
          title={opened.length ? '프롬프트로 가져왔어요' : '가져오지 못했어요'}
          onClose={() => setResults(null)}
          actions={
            <>
              <Button variant="secondary" onClick={() => setResults(null)}>
                닫기
              </Button>
              {only && (
                <Button
                  onClick={() => {
                    setResults(null);
                    onOpen(only.id);
                  }}
                >
                  열어 보기
                </Button>
              )}
            </>
          }
        >
          <Stack gap="section">
            {results.map((result, index) => (
              <Summary key={index} result={result} />
            ))}
          </Stack>
        </Dialog>
      )}
    </>
  );
  return { take: (files) => void take(files), view };
}

function Summary({ result }: { result: Result }) {
  if ('failure' in result) {
    return (
      <Section title={result.file}>
        <Callout tone="warn">{result.failure}</Callout>
      </Section>
    );
  }
  const { blocks, authorNote, name } = result.prompt;
  const toggles = result.prompt.toggles.filter(isToggle);
  const texts = blocks.filter((block) => block.kind === 'text').length;
  const came = [
    { tone: 'done' as const, title: `블록 ${blocks.length}개 · 직접 입력 ${texts}개, 자동 입력 ${blocks.length - texts}개` },
    ...(toggles.length ? [{ tone: 'done' as const, title: `토글 ${toggles.length}개 · ${toggles.map((toggle) => toggle.label).join(', ')}` }] : []),
    ...(authorNote.trim() ? [{ tone: 'done' as const, title: '기본 노트' }] : []),
  ];
  const missed = result.unsupported.map((item) => ({ tone: 'missed' as const, ...UNSUPPORTED[item.kind](item.count) }));
  return (
    <Stack gap="group">
      <Text variant="note">{`${promptName(name)} · Risu 프리셋`}</Text>
      <Section title="가져온 것">
        <Outcome label="가져온 것" items={came} />
      </Section>
      {missed.length > 0 && (
        <Section title="가져오지 않은 것">
          <Outcome label="가져오지 않은 것" items={missed} />
        </Section>
      )}
    </Stack>
  );
}
