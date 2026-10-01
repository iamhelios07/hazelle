import { useEffect, useState } from 'react';
import type { Break, Forecast } from '../../runtime/cache';
import { tokens } from '../common/receipt';
import { SendNote } from '../ui';
import { partName } from './ChatSent';
import type { OpenChat } from './useChat';

const TITLE = '캐시가 남은 시간';

function why(broken: Break): string {
  switch (broken.kind) {
    case 'model':
      return '모델이나 연결이 직전 요청과 달라요.';
    case 'reasoning':
      return '생각 설정이 직전 요청과 달라요.';
    case 'off':
      return '이 모델 설정은 캐시를 꺼 두었어요.';
    case 'differs':
      return broken.from.kind === 'block' && broken.from.slot === 'chat'
        ? '직전에 보낸 대화 메시지가 빠졌거나 고쳐졌어요. 컨텍스트 한도로 앞쪽 대화가 잘려도 그래요.'
        : `'${partName(broken.from, broken.role)}' 부분이 직전 요청과 달라요.`;
    case 'added':
      return `'${partName(broken.from, broken.role)}' 부분이 새로 들어가요.`;
  }
}

const reads = ({ read, of }: Forecast) => (read > 0 ? `캐시에서 약 ${tokens(read)} 토큰만 읽어요. 직전에는 ${tokens(of)} 토큰이 캐시됐어요.` : '캐시를 읽지 못하고 처음부터 다시 써요.');

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

// 캐시 (design §4.4): the time left on what the chat's last call cached, and a warning when sending now would not read it.
export function ChatCache({ cache }: { cache: OpenChat['cache'] }) {
  const now = useNow(cache?.until ?? null);
  if (!cache || now >= cache.until) return null;
  const left = clock(cache.until - now);
  const broken = cache.forecast?.broken;
  return <SendNote label={left} title={TITLE} warning={broken ? { words: '깨짐 예상', why: `${why(broken)} ${reads(cache.forecast!)}` } : undefined} />;
}
