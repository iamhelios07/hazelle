type Equal<T> = (previous: T, next: T) => boolean;
type Rules<T> = Partial<{ [K in keyof T]: Equal<T[K]> }> & { [K in keyof T as Extract<T[K], object> extends never ? never : K]-?: Equal<T[K]> };
type RowPart<T> = { value: T; same(next: RowPart<T>): boolean };

export function sameFields<T extends object>(previous: T | null, next: T | null): boolean {
  if (Object.is(previous, next)) return true;
  if (previous === null || next === null) return false;
  const keys = Object.keys(previous) as (keyof T)[];
  return keys.length === Object.keys(next).length && keys.every((key) => Object.hasOwn(next, key) && Object.is(previous[key], next[key]));
}

export const sameItems = <T>(equal: Equal<T>): Equal<readonly T[]> => (previous, next) =>
  previous === next || (previous.length === next.length && previous.every((item, index) => equal(item, next[index]!)));

// Every structured field chooses its rule at the producer; adding one cannot silently inherit reference equality.
export function rowEqual<T extends object>(rules: Rules<T>): Equal<T> {
  const comparisons: Partial<{ [K in keyof T]: Equal<T[K]> }> = rules;
  return (previous, next) => {
    const keys = Object.keys(previous) as (keyof T)[];
    return keys.length === Object.keys(next).length && keys.every((key) =>
      Object.hasOwn(next, key) && (comparisons[key] ?? Object.is)(previous[key], next[key]),
    );
  };
}

export function rowPart<T extends object>(value: T, rules: NoInfer<Rules<T>>): RowPart<T> {
  const equal = rowEqual<T>(rules);
  return {
    value,
    same: (next) => equal(value, next.value),
  };
}

export function sameParts<T>(previous: { [K in keyof T]: RowPart<T[K]> }, next: { [K in keyof T]: RowPart<T[K]> }): boolean {
  const keys = Object.keys(previous) as (keyof T)[];
  return keys.length === Object.keys(next).length && keys.every((key) => Object.hasOwn(next, key) && previous[key].same(next[key]));
}
