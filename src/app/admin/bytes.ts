const MB = 1_000_000;

// 1.2 MB, as the operator reads sizes.
export const megabytes = (bytes: number) => `${(bytes / MB).toLocaleString('ko-KR', { maximumFractionDigits: 1 })} MB`;

// The cap as the field shows it: '' is no cap.
export const capText = (bytes: number | null) => (bytes === null ? '' : String(bytes / MB));

// The cap typed in MB, in bytes: null for an empty field, which is no cap; undefined for what is not a size.
export function typedCap(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const bytes = Math.round(Number(trimmed) * MB);
  return Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : undefined;
}

// A whole count of accounts; undefined for anything else.
export const typedCount = (text: string): number | undefined => (/^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : undefined);
