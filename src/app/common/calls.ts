import type { UsageNoticeKind } from '../../model/settings';
import type { CallPurpose, LogEntry } from '../../runtime/request-log';
import { cost, tokens } from './receipt';
import { FEATURE_NAMES, ROLE_TAGS, SCRIPTS, STAGE_NAMES, TOOL, UNKNOWN } from './words';

const PURPOSES: Record<CallPurpose, string> = {
  reply: '응답',
  translation: FEATURE_NAMES.translate,
  input: '입력 번역',
  note: '번역가의 노트',
  memory: FEATURE_NAMES.memory,
  script: `${SCRIPTS.part}·${TOOL}`,
  illustration: FEATURE_NAMES.illustrate,
  likeness: '삽화 프로필',
  mascot: FEATURE_NAMES.mascot,
  preread: FEATURE_NAMES.preread,
  agent: FEATURE_NAMES.agents,
  embedding: ROLE_TAGS.embed,
};

export const callName = ({ purpose, agent }: Pick<LogEntry, 'purpose' | 'agent'>) => (agent ? `${agent.name} · ${STAGE_NAMES[agent.stage]} ${PURPOSES.agent}` : PURPOSES[purpose]);

export const USAGE_NOTICE_NAMES: Record<UsageNoticeKind, string> = { reply: PURPOSES.reply, ...FEATURE_NAMES, script: PURPOSES.script, embedding: PURPOSES.embedding };

const KIND_OF: Record<CallPurpose, UsageNoticeKind> = {
  reply: 'reply',
  translation: 'translate',
  input: 'translate',
  note: 'translate',
  memory: 'memory',
  embedding: 'embedding',
  script: 'script',
  illustration: 'illustrate',
  likeness: 'illustrate',
  mascot: 'mascot',
  preread: 'preread',
  agent: 'agents',
};

// A failed call says its failure on its own, and one picked up after a reload was not made by this page.
export function usageNotice(entry: LogEntry, kinds: readonly UsageNoticeKind[]): { message: string; detail: string } | null {
  if (entry.picked || entry.receipt.state === 'failed' || !kinds.includes(KIND_OF[entry.purpose])) return null;
  const { usage } = entry.receipt;
  const used = usage ? `입력 ${tokens(usage.inputTokens)} · 출력 ${tokens(usage.outputTokens)}` : `사용량 ${UNKNOWN}`;
  return { message: `${callName(entry)} · ${used}`, detail: `비용 ${cost(entry.receipt.cost)}` };
}
