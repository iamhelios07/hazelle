import { expect, it } from 'vitest';
import { taskModelHelp } from './words';

it("opens a task's model where its help says it is chosen: the prompt with one, 보조 모델's page without", () => {
  expect(taskModelHelp('번역', true)).toEqual({ text: '번역 프롬프트에서 선택해요. 선택하지 않으면 보조 모델을 따라요.', door: '번역 프롬프트 열기' });
  expect(taskModelHelp('번역', false)).toEqual({ text: '번역 프롬프트에서 선택하지 않으면 보조 모델을 따라요. 보조 모델은 설정 › 모델에서 정해요.', door: '설정 › 모델 열기' });
});
