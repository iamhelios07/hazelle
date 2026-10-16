import { expect, it } from 'vitest';
import { apply, extract, fromText, toText } from './copy-text';

it('writes revised Korean back where it now sits, keeping each template expression and refusing text that would break the code', () => {
  const source = [
    "const A = '저장했어요';",
    'const B = `${count}개 남았어요 ${on ? `켜짐` : \'꺼짐\'}`;',
    "const C = <p title=\"제목\">설명이에요</p>;",
    "type D = '타입';",
  ].join('\n');
  const sources = [{ path: 'x.tsx', source }];
  const entries = extract(sources);
  expect(entries.map((entry) => [entry.kind, entry.text])).toEqual([
    ['string', '저장했어요'],
    ['template', '${count}개 남았어요 ${on ? `켜짐` : \'꺼짐\'}'],
    ['template', '켜짐'],
    ['string', '꺼짐'],
    ['string', '제목'],
    ['jsx', '설명이에요'],
  ]);
  const [a, b, nested, off, title, text] = entries;
  const moved = [{ path: 'x.tsx', source: `// a line added since extract\n${source.replace("'저장했어요'", "'저장됨'")}` }];
  const { written, rejected } = apply(moved, entries, [
    { id: a!.id, text: "저장'했어요" },
    { id: b!.id, text: '${count}개 남음 ${on ? `켜짐` : \'꺼짐\'}' },
    { id: nested!.id, text: '켬' },
    { id: off!.id, text: '끔' },
    { id: title!.id, text: '이름' },
    { id: text!.id, text: '설명 {이에요}' },
  ]);
  expect(rejected.map((each) => [each.id, each.reason])).toEqual([
    [a!.id, 'the source changed since extract'],
    [text!.id, 'JSX text cannot hold { } < >'],
  ]);
  expect(written[0]!.source.split('\n').slice(2, 4)).toEqual(['const B = `${count}개 남음 ${on ? `켬` : \'끔\'}`;', 'const C = <p title="이름">설명이에요</p>;']);
  expect(apply(sources, entries, [{ id: a!.id, text: "저장'했어요" }, { id: b!.id, text: '${total}개 남았어요' }]).rejected.map((each) => each.reason)).toEqual(['not one string literal in its quotes', 'the ${…} expressions changed']);
});

it('sends sentences as numbered lines with {n} slots, and reads an answer back into source text, refusing moved slots and renumbered answers', () => {
  const source = [
    "const A = '설정에서 \\'모델\\'을 선택해 주세요.';",
    'const B = `${name} 캐릭터를 ${count}개 옮겼어요.`;',
    "const C = '저장';",
  ].join('\n');
  const list = extract([{ path: 'x.ts', source }]);
  const [body] = toText(list).map((batch) => batch.body.split('\n').filter((line) => /^\[\d/.test(line)));
  expect(body).toEqual(["[1] 설정에서 '모델'을 선택해 주세요.", '[2] {1} 캐릭터를 {2}개 옮겼어요.']);
  const { revised, problems } = fromText(list, ["```text\n[1] '모델'을 설정에서 선택해 주세요.\n[2] {1} 캐릭터 {2}개를 옮겼어요.\n```", '[1] 새 목록\n[2] 지어낸 줄\n[3] 저장하기']);
  expect(revised).toEqual([
    { id: list[0]!.id, text: "\\'모델\\'을 설정에서 선택해 주세요." },
    { id: list[1]!.id, text: '${name} 캐릭터 ${count}개를 옮겼어요.' },
  ]);
  expect(problems).toEqual(['answer 2: 1 of 3 lines were never sent (first 3), so none of it is read']);
  expect(fromText(list, ['[2] {2}개의 {1} 캐릭터를 옮겼어요.']).problems).toEqual([`2 ${list[1]!.id}: the {n} slots changed`]);
});
