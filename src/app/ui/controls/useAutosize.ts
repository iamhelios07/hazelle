import { useLayoutEffect, type RefObject } from 'react';

// The height goes to the field's CSS as --autosize, so a fold can take the field to another height on a transition.
// Passing through auto to measure ends any such transition, so growth while typing never animates. scrollHeight
// leaves out the borders, so they are read from the element and added back.
export function useAutosize(area: RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = 'auto';
    const { borderTopWidth, borderBottomWidth } = getComputedStyle(element);
    element.style.setProperty('--autosize', `${element.scrollHeight + parseFloat(borderTopWidth) + parseFloat(borderBottomWidth)}px`);
    element.style.height = '';
  }, [area, value]);
}
