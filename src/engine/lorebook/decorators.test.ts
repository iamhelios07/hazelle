import { describe, expect, it } from 'vitest';
import { args, parseDecorators } from './decorators';

describe('parseDecorators', () => {
  it('reads the leading @@ block with its @@@ fallbacks, and keeps each value whole', () => {
    const content = '\n@@@role user\r\n@@depth 2\r\n@@@depth x\n@@@end\n@@inject_replace Hello, world \n\n@@probability 5\nbody line\n';
    expect(parseDecorators(content)).toEqual({
      decorators: [
        { name: 'depth', value: '2', fallbacks: [{ name: 'depth', value: 'x' }] },
        { name: 'end', value: '', fallbacks: [] },
        { name: 'inject_replace', value: 'Hello, world', fallbacks: [] },
      ],
      body: '@@probability 5\nbody line',
    });
    expect(args(' a, ,b ,')).toEqual(['a', 'b']);
  });
});
