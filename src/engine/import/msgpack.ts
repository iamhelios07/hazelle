const utf8 = new TextDecoder('utf-8', { fatal: true });

// MessagePack as Risu writes its presets (msgpackr): the standard types, and msgpackr's one extension,
// d4 00 00 for undefined. Anything else, or bytes that end early, throws.
export function readMsgpack(bytes: Uint8Array): unknown {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  // subarray clamps at the end instead of throwing, so the length is checked here.
  const next = (length: number) => {
    const start = at;
    at += length;
    if (at > bytes.length) throw new RangeError('MessagePack ends early');
    return start;
  };
  const str = (length: number) => utf8.decode(bytes.subarray(next(length), at));
  const bin = (length: number) => bytes.slice(next(length), at);
  const array = (length: number) => Array.from({ length }, () => value());
  // fromEntries rather than assignment, so a key named __proto__ stays a plain key.
  const map = (length: number) =>
    Object.fromEntries(
      Array.from({ length }, () => {
        const key = value();
        if (typeof key !== 'string') throw new TypeError('MessagePack map key is not a string');
        return [key, value()];
      }),
    );

  function value(): unknown {
    const type = view.getUint8(next(1));
    if (type < 0x80) return type;
    if (type >= 0xe0) return type - 0x100;
    if (type < 0x90) return map(type & 0x0f);
    if (type < 0xa0) return array(type & 0x0f);
    if (type < 0xc0) return str(type & 0x1f);
    switch (type) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xc4:
        return bin(view.getUint8(next(1)));
      case 0xc5:
        return bin(view.getUint16(next(2)));
      case 0xc6:
        return bin(view.getUint32(next(4)));
      case 0xca:
        return view.getFloat32(next(4));
      case 0xcb:
        return view.getFloat64(next(8));
      case 0xcc:
        return view.getUint8(next(1));
      case 0xcd:
        return view.getUint16(next(2));
      case 0xce:
        return view.getUint32(next(4));
      case 0xcf:
        return Number(view.getBigUint64(next(8)));
      case 0xd0:
        return view.getInt8(next(1));
      case 0xd1:
        return view.getInt16(next(2));
      case 0xd2:
        return view.getInt32(next(4));
      case 0xd3:
        return Number(view.getBigInt64(next(8)));
      case 0xd4:
        if (view.getUint16(next(2)) === 0) return undefined;
        break;
      case 0xd9:
        return str(view.getUint8(next(1)));
      case 0xda:
        return str(view.getUint16(next(2)));
      case 0xdb:
        return str(view.getUint32(next(4)));
      case 0xdc:
        return array(view.getUint16(next(2)));
      case 0xdd:
        return array(view.getUint32(next(4)));
      case 0xde:
        return map(view.getUint16(next(2)));
      case 0xdf:
        return map(view.getUint32(next(4)));
    }
    throw new TypeError(`MessagePack type 0x${type.toString(16)} is not read`);
  }

  return value();
}
