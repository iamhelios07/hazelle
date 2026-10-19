import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, snippet, type Completion, type CompletionContext } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, StreamLanguage, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { linter, lintGutter, lintKeymap, type Diagnostic } from '@codemirror/lint';
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { crosshairCursor, drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, hoverTooltip, keymap, lineNumbers, rectangularSelection } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { useEffect, useRef } from 'react';
import type { Caret, CodeDoc, CodeLanguage } from './codeLanguage';
import styles from './CodeEditor.module.css';

export type CodeEditorProps = { label: string; value: string; onChange: (value: string) => void; language: CodeLanguage; caret?: (handle: Caret | null) => void };

const SYNTAX = { lua: StreamLanguage.define(lua) };

const highlight = HighlightStyle.define([
  { tag: tags.keyword, class: styles.keyword },
  { tag: [tags.string, tags.special(tags.string)], class: styles.string },
  { tag: tags.comment, class: styles.comment },
  { tag: [tags.number, tags.bool, tags.null], class: styles.number },
  { tag: tags.operator, class: styles.operator },
]);

const PHRASES = EditorState.phrases.of({
  Find: '검색', Replace: '바꿀 내용', next: '다음', previous: '이전', all: '모두', 'match case': '대소문자 구분', regexp: '정규식', 'by word': '단어 단위', replace: '바꾸기', 'replace all': '모두 바꾸기', close: '닫기',
  'Go to line': '줄로 이동', go: '이동', Diagnostics: '문제', 'No diagnostics': '문제가 없어요', 'current match': '지금 찾은 것', 'on line': '줄', 'replaced match on line $': '$번째 줄을 바꿨어요', 'replaced $ matches': '$개를 바꿨어요', Completions: '자동완성',
});

function docNode(doc: CodeDoc) {
  const box = document.createElement('div');
  box.className = styles.doc!;
  const form = box.appendChild(document.createElement('code'));
  form.className = styles.form!;
  form.textContent = doc.form;
  box.appendChild(document.createElement('p')).textContent = doc.text;
  if (doc.facts?.length) {
    const list = box.appendChild(document.createElement('dl'));
    list.className = styles.facts!;
    for (const [name, value] of doc.facts) {
      list.appendChild(document.createElement('dt')).textContent = name;
      list.appendChild(document.createElement('dd')).textContent = value;
    }
  }
  return box;
}

function languageExtensions(language: CodeLanguage, label: string) {
  const complete = (context: CompletionContext) => {
    const node = syntaxTree(context.state).resolveInner(context.pos, -1).name;
    const place = /string/.test(node) ? 'string' : /comment/.test(node) ? 'comment' : 'code';
    const found = language.complete(context.state.doc.toString(), context.pos, place, context.explicit);
    if (!found) return null;
    const options = found.items.map(({ label: name, kind, detail, template, boost, doc }): Completion => ({ label: name, type: kind, detail, boost, ...(template !== undefined && { apply: snippet(template) }), ...(doc && { info: () => docNode(doc) }) }));
    return { from: found.from, options, validFor: found.validFor };
  };
  const lint = async (view: EditorView): Promise<Diagnostic[]> =>
    (await language.lint(view.state.doc.toString())).map(({ from, to, severity, message, fix }) => ({
      from, to, severity, message,
      ...(fix && { actions: [{ name: fix.label, apply: (target: EditorView, start: number, end: number) => target.dispatch({ changes: { from: start, to: end, insert: fix.insert } }) }] }),
    }));
  const hover = hoverTooltip((view, pos) => {
    const found = language.explain(view.state.doc.toString(), pos);
    return found && { pos: found.from, end: found.to, above: true, create: () => ({ dom: docNode(found.doc) }) };
  });
  return [
    SYNTAX[language.syntax],
    autocompletion({ override: [complete], icons: false }),
    linter(lint, { delay: 400 }),
    hover,
    EditorView.contentAttributes.of({ 'aria-label': label, 'data-autofocus': '' }),
  ];
}

function extensions(own: Compartment, language: CodeLanguage, label: string, changed: (text: string) => void) {
  return [
    own.of(languageExtensions(language, label)),
    lineNumbers(),
    lintGutter(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    drawSelection(),
    EditorState.allowMultipleSelections.of(true),
    rectangularSelection(),
    crosshairCursor(),
    history(),
    bracketMatching(),
    closeBrackets(),
    indentOnInput(),
    indentUnit.of('  '),
    highlightSelectionMatches(),
    search({ top: true }),
    syntaxHighlighting(highlight),
    // Tab takes an open completion first; with none, the snippet's next stop (its own keymap), then indent.
    Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }])),
    PHRASES,
    EditorView.lineWrapping,
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
    EditorView.updateListener.of((update) => update.docChanged && changed(update.state.doc.toString())),
  ];
}

// Loaded only when 크게 편집 first opens one (CodeField), so the page never pays for CodeMirror until then. The value
// is the caller's: a change the editor did not make (the field's own typing) replaces its text. The editor is made
// once, so its undo history and selection outlive a new language or label, which are swapped in.
export default function CodeEditor({ label, value, onChange, language, caret }: CodeEditorProps) {
  const box = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const own = useRef(new Compartment());
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => {
    const editor = new EditorView({ parent: box.current!, state: EditorState.create({ doc: value, extensions: extensions(own.current, language, label, (text) => latest.current(text)) }) });
    view.current = editor;
    caret?.({
      focus: () => editor.focus(),
      selection: () => [editor.state.selection.main.from, editor.state.selection.main.to],
      select: ([from, to]) => editor.dispatch({ selection: { anchor: Math.min(from, editor.state.doc.length), head: Math.min(to, editor.state.doc.length) }, scrollIntoView: true }),
    });
    return () => {
      caret?.(null);
      editor.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: own.current.reconfigure(languageExtensions(language, label)) });
  }, [language, label]);

  // CodeMirror keeps \n lines whatever it was given: code stored with \r\n (a bot written on Windows) is the same
  // text, and replacing it would mark the script changed on open.
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== value.replace(/\r\n?/g, '\n')) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={box} className={styles.editor} />;
}
