const clock = new Intl.DateTimeFormat('ko-KR', { hour: 'numeric', minute: '2-digit' });
const date = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric' });
const weekday = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });

const daysBetween = (at: number, now: number) => Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);

// 오후 11:02
export const timeOfDay = (at: number) => clock.format(at);

// How long ago, as a chat list says it: 방금, 오후 11:02, 어제, 3일 전, 9월 27일.
export function ago(at: number, now = Date.now()): string {
  if (now - at < 60_000) return '방금';
  const days = daysBetween(at, now);
  if (days === 0) return clock.format(at);
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;
  return date.format(at);
}

// The day a run of messages was written: 오늘, 어제, 9월 27일 토요일.
export function day(at: number, now = Date.now()): string {
  const days = daysBetween(at, now);
  return days === 0 ? '오늘' : days === 1 ? '어제' : weekday.format(at);
}
