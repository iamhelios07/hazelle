import { ArrowDownToLine, BookOpen, IdCard, MessageSquare, PenLine, Sparkle, Text, User, UserRound, type LucideIcon } from 'lucide-react';
import type { Block, ChatRange, Role, SlotKind, TextBlock } from '../../model/prompt';
import type { OutlineKind } from '../ui';
import { toggleUses } from './rekey';

export const SLOT = {
  description: { name: '캐릭터 설명', hint: '카드의 설명 · 성격 · 상황 · 예시 대화', line: '캐릭터 카드의 설명, 성격, 상황, 예시 대화가 여기에 들어가요.', kind: 'char', icon: IdCard },
  persona: { name: '페르소나', hint: '이 채팅에서 내가 맡은 사람의 설명', line: '이 채팅의 페르소나 설명이 여기에 들어가요.', kind: 'char', icon: UserRound },
  lorebook: {
    name: '로어북',
    hint: '이번 대화에서 떠오른 로어북 항목',
    line: '이번 대화에서 떠오른 로어북 항목이 여기에 들어가요. 항목마다 역할이 따로 있어서 이 자리에는 역할이 없어요.',
    kind: 'lore',
    icon: BookOpen,
  },
  authorNote: { name: '작가의 노트', hint: '채팅마다 따로 쓰는 메모', line: '채팅마다 따로 쓰는 작가의 노트가 여기에 들어가요.', kind: 'note', icon: PenLine },
  postEverything: { name: '최종 삽입', hint: '맨 끝으로 정한 로어북 항목이 여기 붙어요', line: '로어북에서 맨 끝으로 정한 항목이 여기 붙어요.', kind: 'lore', icon: ArrowDownToLine },
  chat: { name: '채팅', hint: '지금까지 주고받은 메시지', line: '지금까지 주고받은 메시지 가운데 아래 범위가 여기에 들어가요.', kind: 'chat', icon: MessageSquare },
} satisfies Record<SlotKind, { name: string; hint: string; line: string; kind: OutlineKind; icon: LucideIcon }>;

export const ROLES: { value: Role; label: string }[] = [
  { value: 'system', label: '시스템' },
  { value: 'user', label: '사용자' },
  { value: 'assistant', label: 'AI' },
];
export const roleWord = (role: Role) => ROLES.find((option) => option.value === role)!.label;

export const TEXTS: { role: Role; name: string; hint: string }[] = [
  { role: 'system', name: '시스템 글', hint: '규칙과 지시를 적어요' },
  { role: 'user', name: '사용자 글', hint: '내가 한 말처럼 보내요' },
  { role: 'assistant', name: 'AI 글', hint: '모델이 한 말처럼 보내요. 답장 첫머리를 정할 때 써요' },
];

export const MARKS = {
  main: { label: '본문', hint: '카드의 ‘시스템 프롬프트’가 대신해요', card: '시스템 프롬프트' },
  globalNote: { label: '글로벌 노트', hint: '카드의 ‘대화 뒤 지시문’이 대신해요', card: '대화 뒤 지시문' },
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

const firstLine = (text: string) => text.trim().split('\n')[0]!.trim();

// A block's title: its name, else a slot's kind or a text's first line, which reads dimmed.
export function blockTitle(block: Block): { title: string; dim: boolean } {
  if (block.name) return { title: block.name, dim: false };
  if (block.kind === 'slot') return { title: SLOT[block.slot].name, dim: false };
  return { title: firstLine(block.text) || `빈 ${TEXTS.find((text) => text.role === block.role)!.name}`, dim: true };
}

export const blockKind = (block: Block): OutlineKind => (block.kind === 'text' ? 'text' : SLOT[block.slot].kind);
export const blockIcon = (block: Block): LucideIcon => (block.kind === 'text' ? TEXT_ICONS[block.role] : SLOT[block.slot].icon);

export function blockMeta(block: Block): string {
  if (block.kind === 'text') return block.text ? `${block.text.length.toLocaleString('ko-KR')}자` : '비어 있음';
  if (block.slot === 'chat') return describeRange(block.range).meta;
  return 'role' in block ? roleWord(block.role) : '';
}

// The CBS a block sends: a text's own, or a wrapped slot's 감싸는 글.
export const blockSource = (block: Block): string => (block.kind === 'text' ? block.text : 'wrapper' in block ? (block.wrapper ?? '') : '');

export const hasConditions = (block: Block) => toggleUses(blockSource(block)).length > 0;

export const isText = (block: Block): block is TextBlock => block.kind === 'text';
