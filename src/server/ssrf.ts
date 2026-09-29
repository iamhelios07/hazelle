const REFUSED_V4 = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].map(([network, prefix]) => [parseV4(network as string)!, prefix as number] as const);

// IPv6 is allowlisted to global unicast, so loopback, link-local, unique-local, multicast,
// IPv4-mapped and NAT64 forms are refused without needing to decode the IPv4 inside them.
const GLOBAL_V6 = [parseV6('2000::')!, 3] as const;
const REFUSED_V6 = [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
].map(([network, prefix]) => [parseV6(network as string)!, prefix as number] as const);

export function isPublicAddress(address: string): boolean {
  const v4 = parseV4(address);
  if (v4 !== null) return !REFUSED_V4.some(([network, prefix]) => inV4(v4, network, prefix));
  const v6 = parseV6(address);
  if (v6 !== null) {
    return inV6(v6, ...GLOBAL_V6) && !REFUSED_V6.some(([network, prefix]) => inV6(v6, network, prefix));
  }
  return false;
}

export type TargetRefusal = 'not-https' | 'not-public';

// Only IP literals are checked here. Host names are checked by the platform, whose outbound fetch
// refuses internal addresses.
export function checkTarget(url: URL): TargetRefusal | null {
  if (url.protocol !== 'https:') return 'not-https';
  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  const literal = parseV4(host) !== null || parseV6(host) !== null;
  if (literal && !isPublicAddress(host)) return 'not-public';
  return null;
}

function parseV4(text: string): number | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    value = value * 256 + Number(part);
  }
  return value;
}

function parseV6(text: string): bigint | null {
  let head = text;
  let tailV4: number | null = null;
  if (text.includes('.')) {
    const cut = text.lastIndexOf(':');
    tailV4 = parseV4(text.slice(cut + 1));
    if (tailV4 === null) return null;
    head = `${text.slice(0, cut + 1)}0:0`;
  }
  const halves = head.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  let value = 0n;
  for (const group of [...left, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...right]) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return tailV4 === null ? value : (value & ~0xffffffffn) | BigInt(tailV4);
}

function inV4(address: number, network: number, prefix: number): boolean {
  const size = 2 ** (32 - prefix);
  return Math.floor(address / size) === Math.floor(network / size);
}

function inV6(address: bigint, network: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix);
  return address >> shift === network >> shift;
}
