import { describe, expect, it } from 'vitest';
import { formatRecoveryKey, parseRecoveryKey } from './recovery-key';

const bytes = Uint8Array.from({ length: 32 }, (_, i) => (i * 37 + 11) & 0xff);

describe('recovery key', () => {
  it('formats 32 bytes as 13 groups of 4 and parses them back', () => {
    const text = formatRecoveryKey(bytes);
    expect(text).toMatch(/^([0-9A-HJKMNP-TV-Z]{4}-){12}[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(parseRecoveryKey(text)).toEqual(bytes);
  });

  it('forgives case, spacing and look-alike letters', () => {
    const text = formatRecoveryKey(bytes);
    const sloppy = text.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o').replace(/1/g, 'l');
    expect(parseRecoveryKey(sloppy)).toEqual(bytes);
  });

  it('finds the key inside the downloaded file', () => {
    // The account line ends in letters right before a blank line, which once got read as part of the key.
    const file = `risu-alpha 복구 키\n계정: vaulttester\n\n${formatRecoveryKey(bytes)}\n\n만든 날: 2026-09-27\n`;
    expect(parseRecoveryKey(file)).toEqual(bytes);
  });

  it('refuses a key of the wrong length', () => {
    expect(parseRecoveryKey(formatRecoveryKey(bytes).slice(0, -2))).toBeNull();
  });
});
