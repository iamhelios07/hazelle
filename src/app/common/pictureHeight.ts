import { PICTURE_PERCENT } from '../../model/library';
import { readOptional } from './typedNumber';

export const PICTURE_HEIGHT_ERROR = `${PICTURE_PERCENT.min}에서 ${PICTURE_PERCENT.max} 사이로 입력해 주세요.`;

// undefined: left empty. null: not a height.
export const readPictureHeight = (draft: string) => {
  const value = readOptional(draft, true);
  return typeof value === 'number' && (value < PICTURE_PERCENT.min || value > PICTURE_PERCENT.max) ? null : value;
};
