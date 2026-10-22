type KeysOf<T> = T extends object ? keyof T : never;
type Overlap<A, B> = Extract<A, B> | Extract<B, A>;

type Distinct<Parts extends readonly object[], Keys extends PropertyKey = never> =
  Parts extends readonly [infer First extends object, ...infer Rest extends object[]]
    ? Overlap<KeysOf<First>, Keys> extends never ? [First, ...Distinct<Rest, Keys | KeysOf<First>>] : never
    : [];

type Joined<Parts extends readonly object[]> = Parts extends readonly [infer First, ...infer Rest extends object[]] ? First & Joined<Rest> : unknown;

export function joinParts<Parts extends object[]>(...parts: Parts & Distinct<Parts>): Joined<Parts> {
  return Object.assign({}, ...parts) as Joined<Parts>;
}
