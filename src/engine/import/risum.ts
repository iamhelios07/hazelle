import { isRecord } from '../../connectors/values';

// RPack's decode table, ported under AGPL-3.0 (tech-spec §8): bytes 256-511 of src/ts/rpack/rpack_map.bin in
// github.com/kwaroran/RisuAI at ca1345fca1b65f2f4eac976510b7753e290eaa98. It must equal
// `xxd -p -c 32 -s 256 rpack_map.bin` of that file line for line.
const RPACK = Uint8Array.from(
  [
    '2cf7848bc965fbb69faeb3032d0169741fe4a3ecee5c3421934a0f6ae262029e',
    '229cfd3cfc71c7c6ad596705706d8a4412fa24865fafd17a47cefe5063dd5106',
    '6f18e052a8099d56734cb8536cc3a00e19cf3e0d7e07326846ea48f9992eaba4',
    '49205e5535380cbcd3b1581679280a1ae1f2cdc439dba2ba6072767d95ef7fc8',
    'c0de3794bfb51481922545ace7f566a72b365ac113e34b3ae88d831b7c27b09a',
    '42eb87aadc548e7826d25729d4b7f82f8f8975f04177c21effd81511e5049717',
    'f331d09b00d7cab44f2a3bd9b26bda5da13f3061bd913d4ee6dfbe4d828c1d23',
    '109864f485337b9043bba988f1d6a51cf6cc6eb95b0b96edd5e9c5cb08a68040',
  ]
    .join('')
    .match(/../g)!,
  (pair) => parseInt(pair, 16),
);

const MAGIC = 111;
const VERSION = 0;
const HEADER = 6;

// The main block of a .risum as exportModuleLegacy writes it (src/ts/process/modules.ts): magic, version,
// a u32le length, then the RPack'd JSON {type: 'risuModule', module}. The asset blocks after it are not
// read: Risu's charx import takes only the module's regex, triggers and lorebook.
export function readRisum(bytes: Uint8Array): Record<string, unknown> | null {
  if (bytes.length < HEADER || bytes[0] !== MAGIC || bytes[1] !== VERSION) return null;
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(2, true);
  if (HEADER + length > bytes.length) return null;
  const json = new TextDecoder().decode(bytes.subarray(HEADER, HEADER + length).map((byte) => RPACK[byte]!));
  let main: unknown;
  try {
    main = JSON.parse(json);
  } catch {
    return null;
  }
  return isRecord(main) && main.type === 'risuModule' && isRecord(main.module) ? main.module : null;
}
