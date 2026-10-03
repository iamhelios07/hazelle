import { useLayoutEffect, type RefObject } from 'react';

// scrollHeight leaves out the borders, so they are read from the element and added back.
export function useAutosize(area: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = 'auto';
    const { borderTopWidth, borderBottomWidth } = getComputedStyle(element);
    element.style.height = `${element.scrollHeight + parseFloat(borderTopWidth) + parseFloat(borderBottomWidth)}px`;
  }, [area, value]);
}
