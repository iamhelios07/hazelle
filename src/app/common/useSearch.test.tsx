import { act, type ReactElement } from 'react';
import { expect, it, vi } from 'vitest';
import { probeRoot } from './probe';
import { SEARCH_FROM } from './search';
import { useSearch } from './useSearch';

it('keeps the field while words are typed after the list shrinks, and finds nothing missing without words', async () => {
  let search: ReturnType<typeof useSearch<string>>;
  function Probe({ items }: { items: string[] }) {
    search = useSearch(items, '검색', (item) => [item]);
    return null;
  }
  const many = Array.from({ length: SEARCH_FROM }, (_, index) => `항목 ${index}`);
  const root = probeRoot();
  try {
    await act(() => root.render(<Probe items={[]} />));
    expect(search!.field).toBe(false);
    expect(search!.none).toBeNull();
    await act(() => root.render(<Probe items={many} />));
    await act(() => (search!.field as ReactElement<{ onChange: (value: string) => void }>).props.onChange('항목 1'));
    await act(() => root.render(<Probe items={many.slice(0, 2)} />));
    expect(search!.field).toBeTruthy();
    expect(search!.found).toEqual(['항목 1']);
    expect(search!.none).toBeNull();
  } finally {
    await act(() => root.unmount());
    vi.unstubAllGlobals();
  }
});
