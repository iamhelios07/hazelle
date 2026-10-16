import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { artistTags, picturePrompt } from './picture-prompt';
import { concat } from './png';

const encoder = new TextEncoder();
const u32 = (value: number, little = false) => {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, little);
  return out;
};

const png = (...chunks: [string, Uint8Array][]) =>
  concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), ...[...chunks, ['IEND', new Uint8Array()] as [string, Uint8Array]].flatMap(([type, data]) => [u32(data.length), encoder.encode(type), data, u32(0)])]);

// A little-endian TIFF: IFD0 holding ImageDescription, or a pointer to an Exif IFD holding UserComment.
function exif(tag: 0x010e | 0x9286, text: Uint8Array) {
  const entry = (id: number, type: number, count: number, value: number) => {
    const out = new Uint8Array(12);
    const view = new DataView(out.buffer);
    view.setUint16(0, id, true);
    view.setUint16(2, type, true);
    view.setUint32(4, count, true);
    view.setUint32(8, value, true);
    return out;
  };
  const ifd = (one: Uint8Array) => concat([new Uint8Array([1, 0]), one, u32(0, true)]);
  if (tag === 0x010e) return concat([encoder.encode('II*\0'), u32(8, true), ifd(entry(tag, 2, text.length, 8 + 18)), text]);
  return concat([encoder.encode('II*\0'), u32(8, true), ifd(entry(0x8769, 4, 1, 8 + 18)), ifd(entry(tag, 7, text.length, 8 + 36)), text]);
}
const webp = (chunk: Uint8Array) => {
  const body = concat([encoder.encode('WEBP'), encoder.encode('VP8 '), u32(0, true), encoder.encode('EXIF'), u32(chunk.length, true), chunk, new Uint8Array(chunk.length & 1)]);
  return concat([encoder.encode('RIFF'), u32(body.length, true), body]);
};

const V3 = JSON.stringify({ prompt: '1girl, {artist:a}, silver hair', uc: 'artist:avoided, lowres', steps: 28 });
const V4 = JSON.stringify({ prompt: 'whole', v4_prompt: { caption: { base_caption: '0.8::artist:b::, indoors', char_captions: [{ char_caption: 'girl, red eyes', centers: [] }, { char_caption: ' ' }] } } });

describe('picturePrompt', () => {
  it('reads NovelAI’s prompt from a PNG Comment, plain or packed, and from a WebP’s EXIF UserComment or ImageDescription', () => {
    const v3 = { prompt: '1girl, {artist:a}, silver hair', characters: [] };
    const v4 = { prompt: '0.8::artist:b::, indoors', characters: ['girl, red eyes'] };
    expect(picturePrompt(png(['tEXt', encoder.encode(`Comment\0${V3}`)]))).toEqual(v3);
    expect(picturePrompt(png(['zTXt', concat([encoder.encode('Comment\0\0'), zlibSync(encoder.encode(V4))])]))).toEqual(v4);
    expect(picturePrompt(webp(exif(0x9286, encoder.encode(`ASCII\0\0\0${V4}\0`))))).toEqual(v4);
    expect(picturePrompt(webp(exif(0x010e, encoder.encode(V3))))).toEqual(v3);
  });

  it('answers null for a picture without one: another generator’s text, another key, or no metadata', () => {
    expect(picturePrompt(webp(exif(0x9286, encoder.encode('ASCII\0\0\x001girl, smile\nNegative prompt: lowres'))))).toBeNull();
    expect(picturePrompt(png(['tEXt', encoder.encode(`Description\0${V3}`)]))).toBeNull();
    expect(picturePrompt(png())).toBeNull();
    expect(picturePrompt(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe('artistTags', () => {
  it('keeps each artist stretch as written: a weighted span with its commas, braces and brackets, a span closed by a bare ::', () => {
    expect(artistTags('0.5::artist:a, artist:b ::, 1girl, {artist:c}, [[artist: d]], -6::artist collaboration::, 1.4::artist:e, ::artist:f, year 2024')).toEqual([
      '0.5::artist:a, artist:b ::',
      '{artist:c}',
      '[[artist: d]]',
      '1.4::artist:e, ::',
      'artist:f',
    ]);
  });
});
