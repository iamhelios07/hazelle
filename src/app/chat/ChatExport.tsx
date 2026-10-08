import { Copy, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ChatItem } from '../../model/chat';
import { assetDataUrls } from '../../runtime/assets';
import { chatFile } from '../../runtime/chat-file';
import { download } from '../common/download';
import { useCopyHtml } from '../common/useCopy';
import { ARCA_LOG, CHAT_FILE, EXPORT } from '../common/words';
import { useDisplay } from '../display';
import { useFiles, useStore } from '../session';
import { Button, Callout, ChoiceGroup, Dialog, LogExport, NumberInput, Progress, SettingRow, snapshotPage, Stack, Switch, Text, type LogRow } from '../ui';
import { speakers } from './ChatLog';
import { logDraft, resolveLog, type LogChoices, type LogText } from './exportLog';
import type { OpenChat } from './useChat';

// What no file system takes in a name.
const UNSAFE = /[\\/:*?"<>|\p{Cc}]/gu;
const fileNamed = (title: string, extension: string) => `${title.replace(UNSAFE, '').trim() || '채팅'}.${extension}`;

// A chat up to SHORT messages goes whole by default; a longer one from its last LATEST.
const SHORT = 100;
const LATEST = 50;

const FORMS = [{ value: 'log', label: ARCA_LOG }, { value: 'file', label: CHAT_FILE }] as const;
const TEXTS: { value: LogText; label: string }[] = [{ value: 'translation', label: '번역' }, { value: 'original', label: '원문' }, { value: 'both', label: '둘 다' }];

type Drawing = { key: string; title: string; sub: string | null; css: string; rows: LogRow[]; missing: number };
type Prepared = { html: string; size: string; missing: number; rules: number };

const megabytes = (text: string) => `${(new Blob([text]).size / 1024 / 1024).toFixed(1)}MB`;

export function ChatExport({ chat, item }: { chat: OpenChat; item: ChatItem }) {
  const store = useStore();
  const files = useFiles();
  const { reading, display } = useDisplay();
  const copyHtml = useCopyHtml();
  const { messages, view, decor, card, busy, displayPending } = chat;
  const [form, setForm] = useState<'log' | 'file'>('log');
  const [choices, setChoices] = useState<LogChoices>(() => ({ pictures: !display.hidePictures, hideMe: false, text: 'translation', from: messages.length > SHORT ? messages.length - LATEST + 1 : 1, to: messages.length }));
  const [range, setRange] = useState({ from: String(choices.from), to: String(choices.to) });
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const waiting = busy ? '응답이 끝나면 내보낼 수 있어요.' : displayPending || view.pass ? '채팅을 불러오는 중이에요.' : null;
  const translated = messages.some((message) => message.versions.some((version) => version.translation));
  const change = (next: Partial<LogChoices>) => setChoices({ ...choices, ...next });

  useEffect(() => {
    setPrepared(null);
    setDrawing(null);
    if (form !== 'log' || waiting) return;
    let live = true;
    const draft = logDraft(messages, view, decor.bot, speakers(chat), choices);
    const read = choices.pictures ? assetDataUrls(store, files, draft.assets) : Promise.resolve({ urls: new Map<string, string>(), missing: draft.assets.size });
    void read.then(({ urls, missing }) => {
      if (live) setDrawing({ key: crypto.randomUUID(), title: item.title, sub: card?.name ?? null, ...resolveLog(draft, (id) => urls.get(id)), missing });
    });
    return () => {
      live = false;
    };
  }, [form, choices, messages, view, waiting]);

  function saveFile() {
    if (form === 'file') return download(fileNamed(item.title, 'json'), new Blob([chatFile(store, item.id)], { type: 'application/json' }));
    const page = snapshotPage(item.title, prepared!.html, getComputedStyle(document.body).backgroundColor);
    download(fileNamed(item.title, 'html'), new Blob([page], { type: 'text/html' }));
  }

  // A typed number is taken once it lies in the chat; anything else waits, marked.
  function typeRange(edge: 'from' | 'to', text: string) {
    setRange({ ...range, [edge]: text });
    const next = { ...choices, [edge]: Number(text) };
    if (Number.isInteger(next[edge]) && next.from >= 1 && next.from <= next.to && next.to <= messages.length) setChoices(next);
  }
  const typed = (edge: 'from' | 'to') => Number(range[edge]) === choices[edge];

  const ready = form === 'file' || prepared !== null;
  const lost = prepared && [prepared.missing > 0 && `이미지 ${prepared.missing}개`, prepared.rules > 0 && `스타일 ${prepared.rules}개`].filter(Boolean).join(', ');
  return (
    <Dialog
      title={EXPORT}
      onClose={chat.actions.closeDialog}
      actions={
        <>
          {form === 'log' && (
            <Button variant="secondary" icon={Copy} disabled={!ready} onClick={() => copyHtml(prepared!.html)}>
              복사
            </Button>
          )}
          <Button icon={Download} disabled={!ready} onClick={saveFile}>
            저장
          </Button>
        </>
      }
    >
      <Stack gap="related">
        <ChoiceGroup layout="segmented" label="형식" options={[...FORMS]} value={form} onChange={setForm} />
        {form === 'log' && (
          <>
            <SettingRow place="panel" label="처음" control={<NumberInput label="처음" unit="번째" value={range.from} invalid={!typed('from')} onChange={(text) => typeRange('from', text)} />} />
            <SettingRow place="panel" label="끝" note={`메시지 ${messages.length}개`} control={<NumberInput label="끝" unit="번째" value={range.to} invalid={!typed('to')} onChange={(text) => typeRange('to', text)} />} />
            {translated && <SettingRow place="panel" label="메시지" control={<ChoiceGroup layout="segmented" label="메시지" options={TEXTS} value={choices.text} onChange={(text) => change({ text })} />} />}
            <SettingRow place="panel" label="이미지 포함" control={<Switch label="이미지 포함" checked={choices.pictures} onChange={(pictures) => change({ pictures })} />} />
            <SettingRow place="panel" label="내 이름 가리기" control={<Switch label="내 이름 가리기" checked={choices.hideMe} onChange={(hideMe) => change({ hideMe })} />} />
            {waiting ? (
              <Text variant="note">{waiting}</Text>
            ) : prepared ? (
              <>
                <Text variant="note">{`크기 ${prepared.size}`}</Text>
                {lost && <Callout tone="warn">{`빠진 것: ${lost}`}</Callout>}
              </>
            ) : (
              <Progress steps={[{ label: drawing ? '그리는 중' : choices.pictures ? '이미지 읽는 중' : '준비하는 중' }]} />
            )}
          </>
        )}
      </Stack>
      {drawing && (
        <LogExport
          key={drawing.key}
          title={drawing.title}
          sub={drawing.sub}
          css={drawing.css}
          rows={drawing.rows}
          reading={reading}
          onDrawn={({ html, rules }) => {
            setPrepared({ html, size: megabytes(html), rules, missing: drawing.missing });
            setDrawing(null);
          }}
        />
      )}
    </Dialog>
  );
}
