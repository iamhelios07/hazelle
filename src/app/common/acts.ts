import { CopyPlus, Copy, Download, Pencil, Plus, RefreshCw, RotateCcw, RotateCw, Trash2, Upload, type LucideIcon } from 'lucide-react';
import { EXPORT } from './words';

// What the user does to a thing reads with one word and one icon on every screen; lint refuses these icons
// anywhere else (eslint.config.js). 다시 시도 repeats what failed, 다시 생성 asks for another of what worked, 복원
// brings back from 휴지통: three acts, three icons. 가져오기 sends a file up into the app and 내보내기 brings one down to the
// device; lucide's Import would read as Download beside it.
type Act = { label: string; icon: LucideIcon };

export const ACTS = {
  create: { label: '추가', icon: Plus },
  import: { label: '가져오기', icon: Upload },
  export: { label: EXPORT, icon: Download },
  remove: { label: '삭제', icon: Trash2 },
  duplicate: { label: '사본 만들기', icon: CopyPlus },
  copy: { label: '복사', icon: Copy },
  rename: { label: '이름 바꾸기', icon: Pencil },
  retry: { label: '다시 시도', icon: RotateCw },
  regenerate: { label: '다시 생성', icon: RefreshCw },
  restore: { label: '복원', icon: RotateCcw },
} satisfies Record<string, Act>;

// 새 X makes a thing of its own; X 추가 puts an entry into the list that owns it.
export const newOf = (noun: string) => `새 ${noun}`;
export const addOf = (noun: string) => `${noun} ${ACTS.create.label}`;
export const importOf = (noun: string) => `${noun} ${ACTS.import.label}`;
export const exportOf = (noun: string) => `${noun} ${ACTS.export.label}`;
