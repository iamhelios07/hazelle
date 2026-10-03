import { Evaluator, type EvaluationDown, type EvaluationUp } from './evaluation-core';

const evaluator = new Evaluator();
const scope = self as unknown as { postMessage(message: EvaluationUp): void };
addEventListener('message', ({ data }: MessageEvent<EvaluationDown>) => {
  if ('forget' in data) return evaluator.forget(data.forget);
  void evaluator.run(data.input).then(
    (result) => scope.postMessage({ id: data.id, result }),
    (error: unknown) => scope.postMessage({ id: data.id, error: String(error) }),
  );
});
