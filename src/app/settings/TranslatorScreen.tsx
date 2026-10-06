import { Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { translateSwitches } from '../../runtime/characters';
import { translationPrompt } from '../../runtime/prompts';
import { translatorOf, type TranslatorFailure } from '../../runtime/translate';
import { translateText, TRANSLATOR_CHAT } from '../../runtime/turn';
import { describeTranslateFailure } from '../common/failure';
import { IntoLanguage } from '../common/IntoLanguage';
import { useCopy } from '../common/useCopy';
import { usePersisted } from '../common/usePersisted';
import { PAGES, TRANSLATION_MODEL_HELP } from '../common/words';
import { useConnections, usePrompts, useSession, useSettings } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { Button, Callout, CodeBlock, IconButton, NavBar, Screen, Section, SettingGroup, SettingRow, Text, TextField } from '../ui';

const LANGUAGE = 'risu-alpha:translator-language';

type Run = { kind: 'idle' } | { kind: 'running'; text: string } | { kind: 'done'; text: string } | { kind: 'failed'; failure: TranslatorFailure };

export function TranslatorScreen({ back }: { back: Back | null }) {
  const session = useSession();
  const { store } = session;
  // translatorOf reads these.
  useSettings();
  usePrompts();
  useConnections();
  const copy = useCopy();
  const [language, setLanguage] = usePersisted(LANGUAGE, (stored) => stored, 'Korean', (name) => name);
  const [source, setSource] = useState('');
  const [run, setRun] = useState<Run>({ kind: 'idle' });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const prompt = translationPrompt(store, translateSwitches(store, null).prompt);
  const translator = translatorOf(store, TRANSLATOR_CHAT);

  async function start() {
    const controller = new AbortController();
    abort.current = controller;
    setRun({ kind: 'running', text: '' });
    const made = await translateText(session, source, language, controller.signal, (text) => setRun({ kind: 'running', text }));
    abort.current = null;
    setRun(made.ok ? { kind: 'done', text: made.translation.text } : made.failure.kind === 'stopped' ? { kind: 'idle' } : { kind: 'failed', failure: made.failure });
  }

  return (
    <Screen width="form" top={<NavBar title={PAGES.translator} {...backBar(back)} />}>
      <TextField label="원문" lines={8} value={source} onChange={setSource} placeholder="번역할 글을 붙여 넣어요." />
      <SettingGroup label="번역">
        <SettingRow
          label="번역할 언어"
          sentence={<IntoLanguage before="" after="" label="번역할 언어" value={language} opens="down" onPick={setLanguage} />}
          control={
            run.kind === 'running' ? (
              <Button variant="secondary" size="sm" onClick={() => abort.current?.abort()}>
                멈추기
              </Button>
            ) : (
              <Button size="sm" disabled={!source.trim() || !translator.ok} onClick={() => void start()}>
                번역하기
              </Button>
            )
          }
        />
        <SettingRow
          label="번역 프롬프트"
          help="모든 채팅의 번역과 같은 프롬프트와 전역 번역가의 노트를 써요. 프롬프트는 채팅의 번역 메뉴에서 바꿔요."
          sub={prompt.kind === 'prompt' ? prompt.prompt.value.name : '없음'}
          control={
            prompt.kind === 'prompt' && (
              <Button variant="ghost" size="sm" onClick={() => navigate({ kind: 'prompt', id: prompt.prompt.id, pane: null })}>
                편집
              </Button>
            )
          }
        />
        <SettingRow
          label="번역 모델"
          help={`${TRANSLATION_MODEL_HELP} 여기서 한 번역은 계정의 사용량에 들어가지 않아요.`}
          control={<Text variant="note">{translator.ok ? translator.route.model.name : describeTranslateFailure(translator.failure)}</Text>}
        />
      </SettingGroup>
      {run.kind !== 'idle' && (
        <Section title="번역" action={run.kind === 'done' && <IconButton icon={Copy} size="sm" label="복사" onClick={() => copy(run.text)} />}>
          {run.kind === 'failed' ? (
            <Callout tone="warn">{`번역하지 못했어요. ${describeTranslateFailure(run.failure)}`}</Callout>
          ) : run.text ? (
            <CodeBlock variant="prose">{run.text}</CodeBlock>
          ) : (
            <Text variant="note">번역하는 중…</Text>
          )}
        </Section>
      )}
    </Screen>
  );
}
