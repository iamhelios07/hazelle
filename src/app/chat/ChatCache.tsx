import { useEffect, useState } from 'react';
import type { CacheBreak, CacheForecast } from '../../model/cache';
import { tokens } from '../common/receipt';
import { SendNote } from '../ui';
import { partName } from './ChatSent';
import type { CacheNotes } from './useSendNotes';

const TITLE = '캐시가 남은 시간';
export const BROKEN = '깨짐 예상';

export function why(broken: CacheBreak): string {
  switch (broken.kind) {
    case 'model':
      return '모델이나 연결이 직전 요청과 달라요.';
    case 'account':
      return '직전 요청과 다른 계정으로 보내요. 캐시는 계정마다 따로예요.';
    case 'reasoning':
      return '추론 설정이 직전 요청과 달라요.';
    case 'off':
      return '이 모델 설정은 캐시를 꺼 두었어요.';
    case 'expired':
      return '캐시 시간이 지났어요.';
    case 'far':
      return '새 캐시 지점이 직전 캐시에서 너무 멀어서 찾지 못해요.';
    case 'changed':
      return broken.from.kind === 'block' && broken.from.slot === 'chat' ? '직전에 보낸 메시지가 수정됐어요.' : `'${partName(broken.from, broken.role)}' 부분이 직전 요청과 달라요.`;
    case 'removed':
      return broken.from.kind === 'block' && broken.from.slot === 'chat' ? '직전에 보낸 메시지가 빠졌어요.' : `'${partName(broken.from, broken.role)}' 부분이 빠져요.`;
    case 'added':
      return `'${partName(broken.from, broken.role)}' 부분이 추가돼요.`;
  }
}

export const reads = ({ read, of }: CacheForecast) => (read > 0 ? `캐시된 ${tokens(of)} 토큰 중 약 ${tokens(read)} 토큰만 읽어요.` : '캐시를 읽지 못해요.');

const clock = (ms: number) => {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

// The ticking lives here, so only this note draws each second.
function useNow(until: number | null) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (until === null) return;
    const tick = () => {
      const at = Date.now();
      setNow(at);
      if (at >= until) window.clearInterval(timer);
    };
    const timer = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(timer);
  }, [until]);
  return now;
}

// 캐시 (design §4.4): the time left on what the chat's last call cached, and a warning when sending now would not read
// it. Pressed, it opens the chat's 캐시 panel.
export function ChatCache({ cache, onOpen }: { cache: CacheNotes; onOpen: () => void }) {
  const now = useNow(cache.until);
  if (cache.until === null || now >= cache.until) return null;
  const against = cache.next?.forecast.against;
  return <SendNote label={clock(cache.until - now)} title={TITLE} warning={against?.broken ? { words: BROKEN, why: `${why(against.broken)} ${reads(against)}` } : undefined} onClick={onOpen} />;
}
