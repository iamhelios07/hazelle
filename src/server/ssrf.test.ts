import { describe, expect, it } from 'vitest';
import { checkTarget, isPublicAddress } from './ssrf';

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    'fe80::1',
    'fd12:3456::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    '64:ff9b::a00:1',
    '2002:a00:1::1',
    '2001::1',
    '2001:db8::1',
    'localhost',
  ])('refuses %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '1.1.1.1', '104.18.32.47', '2606:4700::1111', '2001:4860:4860::8888'])('allows %s', (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe('checkTarget', () => {
  it('requires https', () => {
    expect(checkTarget(new URL('http://api.example.com/v1'))).toBe('not-https');
  });

  it('refuses non-public IP literals', () => {
    expect(checkTarget(new URL('https://127.0.0.1/v1'))).toBe('not-public');
    expect(checkTarget(new URL('https://[::1]/v1'))).toBe('not-public');
    expect(checkTarget(new URL('https://169.254.169.254/latest'))).toBe('not-public');
  });

  it('catches numeric host spellings, which the URL parser normalizes to dotted form', () => {
    expect(checkTarget(new URL('https://2130706433/'))).toBe('not-public');
    expect(checkTarget(new URL('https://0x7f.1/'))).toBe('not-public');
  });

  it('leaves host names to the platform', () => {
    expect(checkTarget(new URL('https://api.example.com/v1'))).toBeNull();
    expect(checkTarget(new URL('https://8.8.8.8/'))).toBeNull();
  });
});
