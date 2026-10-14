import { createContext, useContext } from 'react';

// 이미지 가리기, null while pictures show. revealed holds the story pictures tapped open, by source, until each one's 가리기
// takes it out; each time it turns on it is a new veil, so turning it on again covers them all again.
export type Veil = { revealed: Set<string> };

export const VeilContext = createContext<Veil | null>(null);

export const useVeil = () => useContext(VeilContext);
