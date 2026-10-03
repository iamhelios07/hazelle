// Comment lines and other fields are dropped: providers send keep-alive comments such as ": OPENROUTER PROCESSING",
// and every codec reads its event type from the JSON data, not from the event field.
export class SseParser {
  private buffer = '';

  push(text: string): string[] {
    this.buffer += text;
    const events: string[] = [];
    let boundary = /\r?\n\r?\n/.exec(this.buffer);
    while (boundary) {
      events.push(...data(this.buffer.slice(0, boundary.index)));
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
      boundary = /\r?\n\r?\n/.exec(this.buffer);
    }
    return events;
  }

  // A stream may end without the blank line after its last event.
  end(): string[] {
    const events = data(this.buffer);
    this.buffer = '';
    return events;
  }
}

function data(frame: string): string[] {
  const lines = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''));
  return lines.length ? [lines.join('\n')] : [];
}
