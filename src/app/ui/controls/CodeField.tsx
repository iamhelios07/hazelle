import { lazy, Suspense } from 'react';
import type { CodeEditorProps } from './CodeEditor';
import styles from './CodeEditor.module.css';

const CodeEditor = lazy(() => import('./CodeEditor'));

// A code editor for 크게 편집. While CodeMirror loads, a plain text area stands in, so typing never waits for it.
export function CodeField(props: CodeEditorProps & { area: (element: HTMLTextAreaElement | null) => void }) {
  const { label, value, onChange, prose, area, ...rest } = props;
  return (
    <Suspense fallback={<textarea ref={area} className={prose ? `${styles.loading} ${styles.prose}` : styles.loading} aria-label={label} data-autofocus spellCheck={false} value={value} onChange={(event) => onChange(event.target.value)} />}>
      <CodeEditor label={label} value={value} onChange={onChange} prose={prose} {...rest} />
    </Suspense>
  );
}
