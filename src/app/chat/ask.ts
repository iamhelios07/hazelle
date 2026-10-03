import type { ScriptQuestion } from '../../runtime/scripts';
import { BOT_MODELS_HELP } from '../common/words';
import type { AskAnswer } from '../ui';

// Each value is what Scripts.answer takes for that kind (runtime/scripts): the line typed, 'yes' or a dismissal, an
// option's index, and for a model call 'yes' or 'no'.
export function asking(question: ScriptQuestion['question']): { text?: string; help?: string; answer: AskAnswer } {
  switch (question.kind) {
    case 'input':
      return { text: question.text, answer: { kind: 'line' } };
    case 'confirm':
      return { text: question.text, answer: { kind: 'choices', choices: [{ label: '예', value: 'yes', primary: true }, { label: '아니요', value: null }] } };
    case 'select':
      return { answer: { kind: 'choices', choices: question.options.map((label, index) => ({ label, value: String(index) })) } };
    case 'model':
      return {
        text: '이 봇이 모델을 따로 부르려고 해요',
        help: `${BOT_MODELS_HELP} 캐릭터 편집에서 언제든 바꿀 수 있어요.`,
        answer: { kind: 'choices', choices: [{ label: '허용', value: 'yes', primary: true }, { label: '안 함', value: 'no' }] },
      };
  }
}
