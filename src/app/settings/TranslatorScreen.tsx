import { ArrowRight, ChevronDown, ChevronUp, Eraser, Languages, Square } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { translateSwitches } from '../../runtime/characters';
import { translationPrompt } from '../../runtime/prompts';
import { sendsNotes, translatorOf, type TranslatorFailure } from '../../runtime/translate';
import { translateText, TRANSLATOR_CHAT } from '../../runtime/turn';
import { ACTS } from '../common/acts';
import { describeTranslateFailure } from '../common/failure';
import { LanguageMenu } from '../common/IntoLanguage';
import { count } from '../common/typedNumber';
import { useCopy } from '../common/useCopy';
import { usePersisted } from '../common/usePersisted';
import { DEFAULT_MODELS, NOTE_UNSENT, noteLines, PAGES, STOP, taskModelHelp, TRANSLATOR_NOTE } from '../common/words';
import { useConnections, usePrompts, useSession, useSettings } from '../session';
import { backBar, navigate } from '../shell/router';
import type { Back } from '../shell/routes';
import { SHORTCUTS } from '../shortcuts';
import { Button, Callout, ChipButton, formatKeys, Icon, Menu, MenuHeading, MenuItem, NavBar, pressed, Screen, TranslateDesk } from '../ui';
import { GlobalNoteField } from './GlobalNoteField';

const LANGUAGE = 'risu-alpha:translator-language';

// text: what came before a stop or a failure, kept in view.
type Run =
  | { kind: 'idle' }
  | { kind: 'running'; text: string }
  | { kind: 'done'; text: string; cut: boolean }
  | { kind: 'stopped'; text: string }
  | { kind: 'failed'; text: string; failure: TranslatorFailure };

const characters = (text: string) => (text ? `${count(text.length)}자` : '');

export function TranslatorScreen({ back }: { back: Back | null }) {
  const session = useSession();
  const { store } = session;
  const settings = useSettings();
  // translatorOf reads these too.
  usePrompts();
  useConnections();
  const copy = useCopy();
  const [language, setLanguage] = usePersisted(LANGUAGE, (stored) => stored, 'Korean', (name) => name);
  const [source, setSource] = useState('');
  const [run, setRun] = useState<Run>({ kind: 'idle' });
  const [noteOpen, setNoteOpen] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const prompt = translationPrompt(store, translateSwitches(store, null).prompt);
  const translator = translatorOf(store, TRANSLATOR_CHAT);
  const running = run.kind === 'running';
  const ready = translator.ok && source.trim() !== '' && !running;
  const lines = noteLines(settings.translatorNote);
  const unsent = lines > 0 && translator.ok && !sendsNotes(translator.prompt);

  async function start() {
    if (!ready) return;
    const controller = new AbortController();
    abort.current = controller;
    let last = '';
    setRun({ kind: 'running', text: '' });
    const made = await translateText(session, TRANSLATOR_CHAT, source, language, controller.signal, (text) => {
      last = text;
      setRun({ kind: 'running', text });
    });
    abort.current = null;
    if (made.ok) setRun({ kind: 'done', text: made.translation.text, cut: made.translation.receipt?.state === 'cut' });
    else if (made.failure.kind === 'stopped') setRun(last ? { kind: 'stopped', text: last } : { kind: 'idle' });
    else setRun({ kind: 'failed', text: last, failure: made.failure });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!pressed(event, SHORTCUTS.translate.keys)) return;
    event.preventDefault();
    void start();
  }

  const text = run.kind === 'idle' ? '' : run.text;
  const resultNote =
    run.kind === 'running' ? '번역 중…' : run.kind === 'done' ? [characters(run.text), run.cut && '길이 한도로 잘림'].filter(Boolean).join(' · ') : run.kind === 'stopped' ? `${characters(run.text)} · 번역 중단됨` : '';

  return (
    <Screen width="page" fill top={<NavBar title={PAGES.translator} {...backBar(back)} />}>
      <TranslateDesk
        tools={
          <>
            <Menu
              label="번역 모델"
              trigger={(opener) => (
                <ChipButton
                  label={translator.ok ? translator.route.model.name : '번역 모델 없음'}
                  title="번역 모델"
                  tone={translator.ok ? 'default' : 'warn'}
                  leading={<Icon icon={Languages} size="xs" />}
                  {...opener}
                />
              )}
            >
              <MenuHeading>{translator.ok ? taskModelHelp('번역') : describeTranslateFailure(translator.failure)}</MenuHeading>
              {prompt.kind === 'prompt' && <MenuItem label={`'${prompt.prompt.value.name}' 열기…`} onClick={() => navigate({ kind: 'prompt', id: prompt.prompt.id, pane: null })} />}
              <MenuItem label={`${DEFAULT_MODELS} 열기…`} onClick={() => navigate({ kind: 'models' })} />
              <MenuHeading>여기서 번역한 내용은 저장되지 않아요.</MenuHeading>
            </Menu>
            <Icon icon={ArrowRight} size="xs" />
            <LanguageMenu label="번역할 언어" value={language} opens="down" onPick={setLanguage} />
          </>
        }
        aside={
          <Button variant="ghost" size="sm" icon={noteOpen ? ChevronUp : ChevronDown} expanded={noteOpen} onClick={() => setNoteOpen(!noteOpen)}>
            {lines > 0 ? `${TRANSLATOR_NOTE} · ${lines}줄` : TRANSLATOR_NOTE}
          </Button>
        }
        below={noteOpen && <GlobalNoteField error={unsent ? NOTE_UNSENT : undefined} />}
        source={{
          label: '원문',
          value: source,
          placeholder: `번역할 텍스트를 붙여 넣고 ${formatKeys(SHORTCUTS.translate.keys)}로 번역해요.`,
          readOnly: running,
          onChange: setSource,
          onKeyDown,
          foot: {
            note: characters(source),
            actions: (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Eraser}
                  disabled={running || (!source && !text)}
                  onClick={() => {
                    setSource('');
                    setRun({ kind: 'idle' });
                  }}
                >
                  비우기
                </Button>
                {running ? (
                  <Button variant="secondary" size="sm" icon={Square} onClick={() => abort.current?.abort()}>
                    {STOP}
                  </Button>
                ) : (
                  <Button size="sm" icon={ArrowRight} disabled={!ready} onClick={() => void start()}>
                    번역하기
                  </Button>
                )}
              </>
            ),
          },
        }}
        result={{
          label: '번역 결과',
          text,
          placeholder: running ? '응답 기다리는 중…' : '',
          busy: running,
          notice: run.kind === 'failed' && <Callout tone="warn">{`번역하지 못했어요. ${describeTranslateFailure(run.failure)}`}</Callout>,
          foot: {
            note: resultNote,
            actions: (
              <Button variant="ghost" size="sm" icon={ACTS.copy.icon} disabled={!text || running} onClick={() => copy(text)}>
                {ACTS.copy.label}
              </Button>
            ),
          },
        }}
      />
    </Screen>
  );
}
