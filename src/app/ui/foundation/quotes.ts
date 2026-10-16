import { createContext, useContext } from 'react';

// 대사 모양: how a story's top-level dialogue and 속마음 marks stand, named in Story.shadow.css.
export type QuoteShape = 'color' | 'break' | 'box' | 'quiet';

export const QUOTE_SHAPE: Record<QuoteShape, string> = { color: '색만', break: '줄바꿈', box: '상자', quiet: '상자 · 점선 속마음' };

export const QuoteShapeContext = createContext<QuoteShape>('color');

export const useQuoteShape = () => useContext(QuoteShapeContext);
