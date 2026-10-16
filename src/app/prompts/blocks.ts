import { ArrowDownToLine, BookOpen, History, ScrollText, IdCard, Languages, MessageSquare, MessagesSquare, NotebookPen, PenLine, Smile, Sparkle, Text, User, UserRound, type LucideIcon } from 'lucide-react';
import { autoCachePoints } from '../../engine/cache-points';
import type { Block, ChatRange, Role, SlotKind, TextBlock } from '../../model/prompt';
import { MESSAGE_ROLES, SLOT_NAMES, textName } from '../common/prompt-words';
import { count } from '../common/typedNumber';
import { inFeature } from '../common/words';
import type { OutlineKind } from '../ui';
import { toggleUses } from './rekey';

export const SLOT = {
  tool: { name: SLOT_NAMES.tool, hint: '도구가 보탠 내용', line: '켜 둔 도구가 이번 대화에 덧붙인 내용이 들어가요.', kind: 'note', icon: NotebookPen },
  description: { name: SLOT_NAMES.description, hint: '카드의 설명 · 성격 · 상황 · 예시 대화', line: '캐릭터 카드의 설명과 성격, 시나리오, 예시 대화가 여기에 들어가요.', kind: 'char', icon: IdCard },
  persona: { name: SLOT_NAMES.persona, hint: '이 채팅에서 쓰는 페르소나의 설명', line: '이 채팅에서 쓰는 페르소나 설명이 여기에 들어가요.', kind: 'char', icon: UserRound },
  lorebook: {
    name: SLOT_NAMES.lorebook,
    hint: '이번 대화에서 활성화된 로어북 항목',
    line: '이번 대화에서 켜진 로어북 항목이 여기에 들어가요.',
    kind: 'lore',
    icon: BookOpen,
  },
  authorNote: { name: SLOT_NAMES.authorNote, hint: '채팅별 노트', line: '채팅마다 적어 둔 작가의 노트가 여기에 들어가요.', kind: 'note', icon: PenLine },
  postEverything: { name: SLOT_NAMES.postEverything, hint: '맨 끝에 넣도록 설정한 로어북 항목', line: '로어북에서 맨 끝에 넣도록 정한 항목이 여기에 들어가요.', kind: 'lore', icon: ArrowDownToLine },
  chat: { name: SLOT_NAMES.chat, hint: '지금까지 주고받은 메시지', line: '지금까지 주고받은 메시지 중 아래에서 정한 범위가 여기에 들어가요.', kind: 'chat', icon: MessageSquare },
  note: {
    name: SLOT_NAMES.note,
    hint: '이름과 용어의 번역을 맞추는 메모',
    line: `${inFeature('translate')}의 전역 노트와 캐릭터 편집의 캐릭터 노트가 여기에 들어가요.`,
    kind: 'note',
    icon: NotebookPen,
  },
  recent: {
    name: SLOT_NAMES.recent,
    hint: '번역할 메시지 바로 앞의 메시지와 그 번역',
    line: '번역할 메시지 바로 앞의 원문과 번역문이 여기에 들어가요.',
    kind: 'chat',
    icon: MessagesSquare,
  },
  memory: {
    name: SLOT_NAMES.memory,
    hint: '이 채팅이 기억하는 지난 이야기',
    line: '이 채팅의 장기 기억(상태, 미해결 사건, 기록)이 여기에 들어가요.',
    kind: 'note',
    icon: History,
  },
  span: { name: SLOT_NAMES.span, hint: '기억으로 정리할 메시지', line: '이번에 장기 기억으로 정리할 메시지가 여기에 들어가요.', kind: 'chat', icon: ScrollText },
  source: { name: SLOT_NAMES.source, hint: '번역할 텍스트', line: '번역할 원문 텍스트가 여기에 들어가요.', kind: 'chat', icon: Languages },
  mascot: { name: SLOT_NAMES.mascot, hint: '마스코트의 말투와 표정', line: '마스코트의 말투와 표정, 최근 대사, 답하는 형식이 여기에 들어가요.', kind: 'char', icon: Smile },
} satisfies Record<SlotKind, { name: string; hint: string; line: string; kind: OutlineKind; icon: LucideIcon }>;

export const ROLES: { value: Role; label: string }[] = (['system', 'user', 'assistant'] as const).map((value) => ({ value, label: MESSAGE_ROLES[value] }));

export const TEXTS: { role: Role; name: string; hint: string }[] = [
  { role: 'system', name: textName('system'), hint: '규칙과 지시문을 적어요' },
  { role: 'user', name: textName('user'), hint: '내가 보낸 메시지처럼 들어가요' },
  { role: 'assistant', name: textName('assistant'), hint: '모델 응답의 첫 부분을 미리 정해 둘 때 써요' },
];

export const MARKS = {
  main: { label: '본문', hint: `카드의 '시스템 프롬프트'로 대체돼요`, card: '시스템 프롬프트' },
  globalNote: { label: '글로벌 노트', hint: `카드의 '대화 뒤 지시문'으로 대체돼요`, card: '대화 뒤 지시문' },
} as const;

const TEXT_ICONS: Record<Role, LucideIcon> = { system: Text, user: User, assistant: Sparkle };

// The ranges the 채팅 pane offers; an imported range outside them keeps its own line.
export const RANGES: { range: ChatRange; label: string; meta: string }[] = [
  { range: { from: 0, to: null }, label: '처음부터 끝까지', meta: '전부' },
  { range: { from: 0, to: -1 }, label: '처음부터 마지막 하나 전까지', meta: '마지막 빼고' },
  { range: { from: -1, to: null }, label: '마지막 하나', meta: '마지막 1개' },
  { range: { from: 0, to: -2 }, label: '처음부터 마지막 둘 전까지', meta: '마지막 2개 빼고' },
  { range: { from: -2, to: null }, label: '마지막 둘', meta: '마지막 2개' },
];
export const rangeKey = ({ from, to }: ChatRange) => `${from}:${to ?? 'end'}`;

export function describeRange(range: ChatRange): { label: string; meta: string } {
  const known = RANGES.find((option) => rangeKey(option.range) === rangeKey(range));
  if (known) return known;
  const { from, to } = range;
  const start = from === 0 ? '처음부터' : from > 0 ? `앞의 ${from}개 다음부터` : `끝에서 ${-from}번째부터`;
  const end = to === null ? '끝까지' : to < 0 ? `마지막 ${-to}개 전까지` : `${to}번째까지`;
  return { label: `${start} ${end}`, meta: '직접 정한 범위' };
}

export const firstLine = (text: string) => text.trim().split('\n')[0]!.trim();

export function blockTitle(block: Block): { title: string; dim: boolean } {
  if (block.name) return { title: block.name, dim: false };
  if (block.kind === 'slot') return { title: SLOT[block.slot].name, dim: false };
  return { title: firstLine(block.text) || `빈 ${TEXTS.find((text) => text.role === block.role)!.name}`, dim: true };
}

export const blockKind = (block: Block): OutlineKind => (block.kind === 'text' ? 'text' : SLOT[block.slot].kind);
export const blockIcon = (block: Block): LucideIcon => (block.kind === 'text' ? TEXT_ICONS[block.role] : SLOT[block.slot].icon);

export function blockMeta(block: Block): string {
  if (block.kind === 'text') return block.text ? `${count(block.text.length)}자` : '비어 있음';
  if (block.slot === 'chat') return describeRange(block.range).meta;
  if (block.slot === 'recent') return `${block.count}개${block.translations === false ? ' · 원문만' : ''} · ${MESSAGE_ROLES[block.role]}`;
  return 'role' in block ? MESSAGE_ROLES[block.role] : '';
}

export const blockSource = (block: Block): string => (block.kind === 'text' ? block.text : 'wrapper' in block ? (block.wrapper ?? '') : '');

export const hasConditions = (block: Block) => toggleUses(blockSource(block)).length > 0;

export const isText = (block: Block): block is TextBlock => block.kind === 'text';

export type CacheMark = 'set' | 'auto';

// The cache point after each block: its own, or one the engine sets itself.
export function cacheMarks(blocks: readonly Block[]): Map<string, CacheMark> {
  const auto = autoCachePoints(blocks.map((block) => (block.kind === 'slot' && (block.slot === 'chat' || block.slot === 'memory') ? block.slot : null))).map((index) => blocks[index]!.id);
  const marks = new Map<string, CacheMark>();
  for (const block of blocks) {
    if (block.cache) marks.set(block.id, 'set');
    else if (auto.includes(block.id)) marks.set(block.id, 'auto');
  }
  return marks;
}
