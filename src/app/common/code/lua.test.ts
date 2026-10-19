import { describe, expect, it } from 'vitest';
import { callTemplate, luaLanguage, syntaxMessage } from './lua';
import { LUA_API } from './luaApi';

const api = (name: string) => LUA_API.find((entry) => entry.name === name)!;
const language = luaLanguage(async () => null, [['호감도', '30']]);
const labels = (text: string, place: 'code' | 'string' = 'code') => language.complete(text, text.length, place, false)?.items.map((item) => item.label) ?? [];

describe('Lua code editor', () => {
  it('makes each argument but id a stop, and awaits what returns a promise', () => {
    expect(callTemplate(api('setChatVar'))).toBe('setChatVar(id, ${1:이름}, ${2:값})${0}');
    expect(callTemplate(api('alertInput'))).toBe('alertInput(id, ${1:질문}):await()${0}');
  });

  it('offers the code’s own names, never a name only called, which is a typo of the API', () => {
    const text = 'local mood = getChatVr(id, "a")\nget';
    expect(labels(text)).toContain('getChatVar');
    expect(labels(text)).not.toContain('getChatVr');
    expect(labels('local mood = 1\nmo')).toContain('mood');
    expect(labels('if x then')).toEqual([]);
    expect(labels('if')).toContain('if else');
  });

  it('offers variable names inside a variable call’s name string', () => {
    const text = 'setChatVar(id, "관계", 1)\ngetChatVar(id, "관';
    expect(language.complete(`${text}")`, text.length, 'string', false)?.items.map((item) => item.label)).toEqual(['호감도', '관계']);
  });

  it('marks a typo with its fix and an unsupported call, not a function the code defines', async () => {
    const problems = await language.lint('local function helper() end\nhelper()\ngetChatVr(id, "a")\nsetName(id, "b")');
    expect(problems.map(({ message, fix }) => [message, fix?.insert])).toEqual([
      ['getChatVar의 오타 같아요.', 'getChatVar'],
      ['setName은(는) 헤이젤에 없어서 아무 일도 하지 않아요.', undefined],
    ]);
  });

  it('puts the VM’s syntax error on its line, in Korean', async () => {
    const checked = luaLanguage(async () => ({ line: 2, message: "'end' expected (to close 'function' at line 1) near <eof>" }));
    expect(await checked.lint('function onStart(id)\n  x = 1')).toEqual([{ from: 21, to: 28, severity: 'error', message: '1번째 줄 function의 짝인 end이(가) 없어요.' }]);
    expect(syntaxMessage("unexpected symbol near '+'")).toBe("'+'은(는) 여기 올 수 없어요.");
  });
});
