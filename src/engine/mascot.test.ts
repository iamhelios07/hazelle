import { expect, it } from 'vitest';
import { parseRemark } from './mascot';

it('reads the face and line, a face the sheet does not list as calm, and no line as a failure', () => {
  expect(parseRemark('{"expression": "thrilled", "line": " 드디어 고백한 것이와요! "}', 'yeongae')).toEqual({ ok: true, expression: 'thrilled', line: '드디어 고백한 것이와요!' });
  expect(parseRemark('```json\n{"expression": "smug", "line": "흥."}\n```', 'yeongae')).toEqual({ ok: true, expression: 'calm', line: '흥.' });
  expect(parseRemark('{"expression": "sad", "line": " "}', 'yeongae')).toEqual({ ok: false, reason: 'line' });
  expect(parseRemark('흥, 별것 아니사와요.', 'yeongae')).toEqual({ ok: false, reason: 'unreadable' });
});
