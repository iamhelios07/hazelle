import { cacheRecurrence as recurrence, cacheShortfall as shortfall } from '../engine/cache-history';
import type { Assembled } from '../engine/pipeline';
import type { ChatScope } from '../engine/render';
import type { CacheDiagnosis, CacheText, Forecast } from '../model/cache';
import { calls, type Message, type Receipt } from '../model/chat';
import type { Evaluation } from './evaluation';
import type { LogEntry } from './request-log';
import { tokenProjection } from './token-calibration';

export const needsDiagnosis = (forecast: Forecast) => !!forecast.against?.broken || forecast.parts.some(({ change }) => change !== null) || forecast.removed.length > 0;

export function diagnoseCache(evaluation: Evaluation, chat: string, scope: ChatScope, forecast: Forecast, before: LogEntry | null, prompt: Assembled, wire: CacheText, signal?: AbortSignal): Promise<CacheDiagnosis | null> {
  if (!needsDiagnosis(forecast)) return Promise.resolve(null);
  return evaluation.cacheDiagnosis(chat, scope, { forecast, before: before && { prompt: before.prompt, wire: before.wire }, after: { prompt, wire } }, signal).catch(() => null);
}

export function cacheRecurrence(messages: Message[]) {
  const receipts = new Map<string, { at: number; order: number; receipt: Receipt }>();
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const version of message.versions) {
      for (const receipt of version.receipt ? calls(version.receipt) : []) {
        const old = receipts.get(receipt.id);
        if (!old || version.at < old.at) receipts.set(receipt.id, { at: version.at, order: old?.order ?? receipts.size, receipt });
      }
    }
  }
  return recurrence([...receipts.values()].sort((a, b) => b.at - a.at || b.order - a.order).map(({ receipt }) => receipt));
}

export const cacheShortfall = (receipt: Receipt) => shortfall(receipt.forecast, receipt.usage?.cachedInputTokens ?? null, receipt.calibration ? tokenProjection(receipt.calibration, receipt.usage).ratio : null);
