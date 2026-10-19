// What the code editor is told about a language. The kit draws it; the language's owner (app/common/code) fills it
// from the engine, which the kit cannot import.
export type CodeDoc = { form: string; text: string; facts?: [string, string][] };

export type CodeProblem = { from: number; to: number; severity: 'error' | 'warning'; message: string; fix?: { label: string; insert: string } };

// template: what accepting it inserts, its stops written ${1:이름} and the caret's last place ${0}; a line's leading
// tabs become the editor's indent. closing: the end the template writes itself, which it replaces when it already
// follows the caret (the `}}` that closing brackets typed after `{{`).
export type CodeItem = { label: string; kind: 'function' | 'keyword' | 'variable' | 'namespace'; detail?: string; template?: string; closing?: string; boost?: number; doc?: CodeDoc };

export type CodeCompletion = { from: number; items: CodeItem[]; validFor: RegExp };

// A language that reads its own text marks it in spans, which never overlap: text with tags in it, where a tag is its
// braces and name, separators between its arguments, and its arguments.
export type CodeSpan = { from: number; to: number; kind: 'tag' | 'separator' | 'argument' | 'comment' | 'slot' };

// syntax: lua is CodeMirror's own Lua mode; a function is the language's spans. comment: what Ctrl+/ wraps a
// selection in, when the syntax has no comment of its own. place: what the caret is in, by the syntax's own reading.
export type CodeLanguage = {
  syntax: 'lua' | ((text: string) => CodeSpan[]);
  comment?: { open: string; close: string };
  lint: (text: string) => CodeProblem[] | Promise<CodeProblem[]>;
  complete: (text: string, at: number, place: 'code' | 'string' | 'comment', explicit: boolean) => CodeCompletion | null;
  explain: (text: string, at: number) => { from: number; to: number; doc: CodeDoc } | null;
};

// How 크게 편집 carries the caret between the field and its big copy, whichever control each is.
export type Caret = { focus: () => void; selection: () => [number, number]; select: (at: [number, number]) => void };

export const areaCaret = (area: HTMLTextAreaElement): Caret => ({
  focus: () => area.focus(),
  selection: () => [area.selectionStart, area.selectionEnd],
  select: (at) => area.setSelectionRange(...at),
});
