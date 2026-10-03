import { Evaluator, type EvaluationDown, type EvaluationUp } from './evaluation-core';
import { tokenizer } from './tokenizer';

const evaluator = new Evaluator();
const scope = self as unknown as { postMessage(message: EvaluationUp): void };
addEventListener('message', ({ data }: MessageEvent<EvaluationDown>) => {
  if ('ping' in data) return scope.postMessage({ pong: true });
  if ('warm' in data) return void tokenizer().catch(() => {});
  if ('forget' in data) return evaluator.forget(data.forget);
  void evaluator.run(data.input).then(
    (result) => scope.postMessage({ id: data.id, result }),
    (error: unknown) => scope.postMessage({ id: data.id, error: String(error) }),
  );
});
