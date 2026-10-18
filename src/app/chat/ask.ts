import type { ScriptQuestion } from '../../runtime/script-interactions';
import { CARD_WRITE_ASK_HELP, cardWriteConsent, MEMORY_CLAIM, MEMORY_CLAIM_HELP, modelConsent, modelsHelp, NETWORK_CONSENT, networkAskHelp, type Asker } from '../common/words';
import type { AskAnswer } from '../ui';

const CONSENT: AskAnswer = { kind: 'choices', choices: [{ label: '허용', value: 'yes', primary: true }, { label: '안 함', value: 'no' }] };

// Each value is what Scripts.answer takes for that kind (runtime/scripts): the line typed, 'yes' or a dismissal, an
// option's index, and for a model call, a memory claim, a card write or the network 'yes' or 'no'.
export function asking(question: ScriptQuestion['question'], asker: Asker): { text?: string; help?: string; answer: AskAnswer } {
  switch (question.kind) {
    case 'input':
      return { text: question.text, answer: { kind: 'line' } };
    case 'confirm':
      return { text: question.text, answer: { kind: 'choices', choices: [{ label: '예', value: 'yes', primary: true }, { label: '아니요', value: null }] } };
    case 'select':
      return { text: question.text, answer: { kind: 'choices', choices: question.options.map((label, index) => ({ label, value: String(index) })) } };
    case 'model':
      return {
        text: modelConsent(asker),
        help: modelsHelp(asker),
        answer: CONSENT,
      };
    case 'memory':
      return { text: MEMORY_CLAIM, help: MEMORY_CLAIM_HELP, answer: CONSENT };
    case 'card':
      return { text: cardWriteConsent(asker), help: CARD_WRITE_ASK_HELP, answer: CONSENT };
    case 'network':
      return { text: NETWORK_CONSENT, help: networkAskHelp(question.hosts), answer: CONSENT };
  }
}
