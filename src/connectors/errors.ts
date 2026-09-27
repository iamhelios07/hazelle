import { isRecord } from './values';

// A provider's error body in the shapes seen so far: OpenAI and OpenRouter {error: {message}}, Anthropic
// {type: 'error', error: {message}}, others {message} or {error: '...'}. Anything else, such as
// Cloudflare's plain "error code: 1002", is passed on as text.
export function providerMessage(text: string): string {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return text.trim().slice(0, 300);
  }
  if (isRecord(body)) {
    const error = body.error;
    if (isRecord(error) && typeof error.message === 'string') return error.message;
    if (typeof error === 'string') return error;
    if (typeof body.message === 'string') return body.message;
    if (typeof body.detail === 'string') return body.detail;
  }
  return text.trim().slice(0, 300);
}
