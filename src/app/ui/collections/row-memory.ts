import { createContext, useContext } from 'react';

// Reading choices belong to the collection key, not the lifetime of its mounted DOM.
export type RowMemory = { visited: boolean; state: Map<symbol, unknown> };
export const RowMemoryContext = createContext<RowMemory | null>(null);

export function useRowState<T>(key: symbol, create: () => T): T | null {
  const memory = useContext(RowMemoryContext);
  if (!memory) return null;
  if (!memory.state.has(key)) memory.state.set(key, create());
  return memory.state.get(key) as T;
}
