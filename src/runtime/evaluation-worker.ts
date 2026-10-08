import { onProgress } from '../engine/progress';
import { Evaluator, type EvaluationDown, type EvaluationUp } from './evaluation-core';
import { tokenizer } from './tokenizer';

// Often enough to stay far inside the page's STUCK_MS, seldom enough that posting never slows a long pass.
const PROGRESS_MS = 250;

const evaluator = new Evaluator();
const scope = self as unknown as { postMessage(message: EvaluationUp): void };
let progressed = -Infinity;
onProgress(() => {
  const now = performance.now();
  if (now - progressed < PROGRESS_MS) return;
  progressed = now;
  scope.postMessage({ progress: true });
});
addEventListener('message', ({ data }: MessageEvent<EvaluationDown>) => {
  if ('ping' in data) return scope.postMessage({ pong: true });
  if ('warm' in data) return void tokenizer().catch(() => {});
  if ('forget' in data) return evaluator.forget(data.forget);
  void evaluator.run(data.input, () => scope.postMessage({ started: data.id })).then(
    (result) => scope.postMessage({ id: data.id, result }),
    (error: unknown) => scope.postMessage({ id: data.id, error: String(error) }),
  );
});
