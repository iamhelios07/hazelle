import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Tab, Tabs } from '../collections/Tabs';
import type { CodeEditorProps } from './CodeEditor';
import styles from './CodeEditor.module.css';

const CodeEditor = lazy(() => import('./CodeEditor'));

// A pane beside the code, behind a tab of its own on a narrow screen.
export type CodeAside = { label: string; body: ReactNode };

// A code editor for 크게 편집. While CodeMirror loads, a plain text area stands in, so typing never waits for it.
// Both panes stay mounted across a tab switch, so the editor keeps its caret and scroll.
export function CodeField(props: CodeEditorProps & { area: (element: HTMLTextAreaElement | null) => void; aside?: CodeAside }) {
  const { label, value, onChange, prose, area, aside, ...rest } = props;
  const [asideShown, setAsideShown] = useState(false);
  const editor = (
    <Suspense fallback={<textarea ref={area} className={prose ? `${styles.loading} ${styles.prose}` : styles.loading} aria-label={label} data-autofocus spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} />}>
      <CodeEditor label={label} value={value} onChange={onChange} prose={prose} {...rest} />
    </Suspense>
  );
  if (!aside) return editor;
  return (
    <div className={asideShown ? `${styles.split} ${styles.asideShown}` : styles.split}>
      <div className={styles.tabs}>
        <Tabs label="보기">
          <Tab label="코드" current={!asideShown} onClick={() => setAsideShown(false)} />
          <Tab label={aside.label} current={asideShown} onClick={() => setAsideShown(true)} />
        </Tabs>
      </div>
      <div className={styles.code}>{editor}</div>
      <section className={styles.aside} aria-label={aside.label}>
        {aside.body}
      </section>
    </div>
  );
}
