import { chatRequest, sending, type Route } from './registry';
import type { ChatRequest, HttpRequest } from './types';
import { isRecord, list } from './values';

export type WireText = { segments: { role: string; text: string }[]; messages: number; pictures: number };
export type PreparedChat = { request: HttpRequest; wire: WireText; identity: string };

export function prepareChat(route: Route, asked: ChatRequest): PreparedChat {
  const request = chatRequest(route, asked);
  const settings = sending(route, asked).settings;
  const body = JSON.parse(request.body!) as Record<string, unknown>;
  const wire: WireText = { segments: [], messages: 0, pictures: 0 };
  const content = (value: unknown, role: string) => {
    if (typeof value === 'string') { wire.segments.push({ role, text: value }); return; }
    for (const part of list(value)) {
      if (!isRecord(part)) continue;
      if (typeof part.text === 'string') wire.segments.push({ role, text: part.text });
      else if (part.type === 'image' || part.type === 'image_url' || part.type === 'input_image' || isRecord(part.inlineData)) wire.pictures++;
    }
  };
  // Read only the text-bearing fields of the request already built by the codec, never JSON syntax or image bytes.
  switch (route.endpoint.protocol) {
    case 'anthropic-messages':
      if (body.system !== undefined) { wire.messages++; content(body.system, 'system'); }
      break;
    case 'gemini':
      if (isRecord(body.systemInstruction)) { wire.messages++; content(body.systemInstruction.parts, 'system'); }
      break;
  }
  const messages = route.endpoint.protocol === 'responses' ? body.input : route.endpoint.protocol === 'gemini' ? body.contents : body.messages;
  for (const message of list(messages)) {
    if (!isRecord(message)) continue;
    wire.messages++;
    content(route.endpoint.protocol === 'gemini' ? message.parts : message.content, String(message.role));
  }
  // Text and cache routing keys vary per prompt. Everything else describes the actual request regime.
  const variable = new Set(['messages', 'system', 'systemInstruction', 'contents', 'input', 'prompt_cache_key', 'stream']);
  const regime = Object.fromEntries(Object.entries(body).filter(([key]) => !variable.has(key)).sort(([a], [b]) => a.localeCompare(b)));
  return { request, wire, identity: JSON.stringify([route.endpoint.baseUrl, route.endpoint.protocol, asked.model.id, settings.systemAsUser === true, settings.cache ?? null, regime]) };
}

export type ContextRefusal = { actual: number | null; maximum: number | null };

export function contextRefusal(protocol: string, failure: { status?: number; code?: string; detail: string }): ContextRefusal | null {
  if (failure.status !== undefined && failure.status !== 400 && failure.status !== 413 && failure.status !== 422) return null;
  const { detail, code } = failure;
  if (protocol === 'anthropic-messages') {
    const counts = /prompt is too long:\s*([\d,]+)\s*tokens\s*>\s*([\d,]+)\s*maximum/i.exec(detail);
    if (counts) return { actual: Number(counts[1]!.replaceAll(',', '')), maximum: Number(counts[2]!.replaceAll(',', '')) };
    if (/prompt is too long|input length.*exceed|prompt.*exceed.*context/i.test(detail)) return { actual: null, maximum: null };
  } else if (protocol === 'gemini') {
    const counts = /input token count\s*\(([\d,]+)\)\s*exceeds.*maximum.*\(([\d,]+)\)/i.exec(detail);
    if (counts) return { actual: Number(counts[1]!.replaceAll(',', '')), maximum: Number(counts[2]!.replaceAll(',', '')) };
    if (/input token count.*exceed|input.*exceeds.*token limit/i.test(detail)) return { actual: null, maximum: null };
  } else if ((protocol === 'responses' || protocol === 'chat-completions') && (code === 'context_length_exceeded' || /maximum context length|exceeds the context window|context[_ ]length[_ ]exceeded/i.test(detail))) {
    // OpenAI errors can include output reservation in "requested N". That number is not an exact input observation.
    return { actual: null, maximum: null };
  }
  return null;
}
