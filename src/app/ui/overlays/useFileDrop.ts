import { useEffect, useRef, useState } from 'react';

// How many screens that take dropped files of their own are mounted; while one is, the app-wide drop stands aside.
let screens = 0;

// Files dragged anywhere over the window: true while they are over it, and onDrop takes them when they are
// dropped. dragenter and dragleave fire for every element crossed, so it counts them instead of trusting either one.
// scope 'screen': a screen's own drop, such as 프롬프트 taking a .risup, which the app's character import would refuse.
export function useFileDrop(onDrop: (files: File[]) => void, scope: 'app' | 'screen' = 'app'): boolean {
  const [dragging, setDragging] = useState(false);
  const latest = useRef(onDrop);
  latest.current = onDrop;
  useEffect(() => {
    if (scope === 'screen') screens += 1;
    let depth = 0;
    const carriesFiles = (event: DragEvent) => (scope === 'screen' || screens === 0) && (event.dataTransfer?.types.includes('Files') ?? false);
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth += 1;
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const over = (event: DragEvent) => {
      if (carriesFiles(event)) event.preventDefault();
    };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      latest.current([...(event.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      if (scope === 'screen') screens -= 1;
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [scope]);
  return dragging;
}
