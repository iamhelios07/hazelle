import { unzlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { packPdf, planPdf, textPdf, wrap } from './gemini-pdf';
import type { ChatMessage } from './types';

const said = (role: ChatMessage['role'], content: string): ChatMessage => ({ role, content });

// What a reader of the text layer gets: each Tj's codes through the ToUnicode map, one line per T*.
function extract(pdf: Uint8Array): { lines: string[]; pages: number; offsetsHold: boolean } {
  const text = new TextDecoder('latin1').decode(pdf);
  const streams = [...text.matchAll(/<< \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g)].map((match) => {
    const start = match.index + match[0].length;
    return new TextDecoder().decode(unzlibSync(pdf.subarray(start, start + Number(match[1]))));
  });
  const map = new Map<string, string>();
  for (const [, code, unit] of streams.find((stream) => stream.includes('beginbfchar'))!.matchAll(/<([0-9a-f]{4})> <([0-9a-f]+)>/g)) {
    map.set(code!, String.fromCharCode(...unit!.match(/.{4}/g)!.map((each) => parseInt(each, 16))));
  }
  const lines = streams.filter((stream) => stream.startsWith('BT')).flatMap((stream) =>
    stream.split('\n').slice(1, -1).map((op) => (op === 'T*' ? '' : op.slice(1, op.indexOf('>')).match(/.{4}/g)!.map((code) => map.get(code)).join(''))),
  );
  const offsets = text.slice(text.lastIndexOf('\nxref\n')).match(/^\d{10} 00000 n $/gm)!.map((entry) => parseInt(entry, 10));
  return { lines, pages: Number(/\/Count (\d+)/.exec(text)![1]), offsetsHold: offsets.every((at, index) => text.startsWith(`${index + 1} 0 obj`, at)) };
}

describe('PDF로 보내기', () => {
  it('keeps the leading system prompt and, for recent, at least the last message out of the PDF', () => {
    const messages = [said('system', '규칙'), said('system', '세계'), said('user', '1'), said('assistant', '2'), said('user', '3'), said('assistant', '4'), said('user', '5'), said('system', '지시')];
    const parts = (plan: ReturnType<typeof planPdf>) => plan && [plan.lead, plan.packed, plan.tail].map((each) => each.map(({ content }) => content));
    expect(parts(planPdf(messages, { keep: 'recent', recent: 25 }))).toEqual([['규칙', '세계'], ['1', '2', '3', '4'], ['5', '지시']]);
    expect(parts(planPdf(messages, { keep: 'recent', recent: 1 }))![2]).toEqual(['지시']);
    expect(parts(planPdf(messages, { keep: 'system', recent: 25 }))).toEqual([['규칙', '세계'], ['1', '2', '3', '4', '5', '지시'], []]);
    expect(parts(planPdf(messages, { keep: 'none', recent: 25 }))![1]).toHaveLength(8);
    expect(planPdf(messages.slice(0, 3), { keep: 'recent', recent: 99 })).toBeNull();
    expect(planPdf(messages, { keep: 'system', recent: 25 })!.transcript.startsWith('[user]\n1\n\n[assistant]\n2')).toBe(true);
  });

  it('writes a text layer that reads back as the transcript, paragraphs as U+2029, over pages', () => {
    const transcript = ['[user]', `${'가나다 '.repeat(3000)}끝`, '', '😀 emoji and ASCII', ...Array.from({ length: 7200 }, (_, at) => `줄 ${at}`)].join('\n');
    const read = extract(textPdf(transcript));
    expect(read.lines).toEqual(wrap(transcript.replace(/\n{2,}/g, ' '), 10_800));
    expect(read.lines.join('')).toContain('끝 😀 emoji');
    expect(read.pages).toBe(2);
    expect(read.offsetsHold).toBe(true);
  });

  it('packs into one message carrying the transcript as its document and the packed messages’ pictures', () => {
    const packed = packPdf([said('user', '봐'), { role: 'user', content: '이거', pictures: [{ type: 'image/png', data: 'PNG' }] }, said('user', '끝')], { keep: 'recent', recent: 1 });
    expect(packed.map(({ document, pictures }) => [document, pictures?.map(({ type }) => type)])).toEqual([['[user]\n봐\n\n[user]\n이거', ['image/png']], [undefined, undefined]]);
  });
});
