import { monthDay, timeOfDay } from '../common/time';

export const moment = (at: number) => `${monthDay(at)} ${timeOfDay(at)}`;

// Call counts are kept per UTC day, so their dates read in UTC whatever this device's zone.
export const utcDay = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', timeZone: 'UTC' }).format;

export const times = (count: number) => `${count.toLocaleString('ko-KR')}회`;

export const TIME_FORMAT = '2026-10-01 15:30';

// A time typed as TIME_FORMAT, on this device's clock; undefined for anything else, such as 2월 30일.
export function typedTime(text: string): number | undefined {
  const parts = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text.trim());
  if (!parts) return undefined;
  const [year, month, day, hour, minute] = parts.slice(1).map(Number) as [number, number, number, number, number];
  const at = new Date(year, month - 1, day, hour, minute);
  const same = at.getFullYear() === year && at.getMonth() === month - 1 && at.getDate() === day && at.getHours() === hour && at.getMinutes() === minute;
  return same ? at.getTime() : undefined;
}
