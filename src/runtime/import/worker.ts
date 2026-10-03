import { ImportReader } from './reader';
import type { Down, Up } from './protocol';

const scope = self as unknown as { postMessage(message: Up, transfer: ArrayBuffer[]): void };
const reader = new ImportReader();

addEventListener('message', ({ data }: MessageEvent<Down>) => {
  void reader.handle(data.request).then(
    (result) => {
      const bytes = result instanceof Uint8Array ? result : result && 'bytes' in result ? result.bytes : null;
      scope.postMessage({ id: data.id, result }, bytes ? [bytes.buffer] : []);
    },
    (error: unknown) => scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) }, []),
  );
});
