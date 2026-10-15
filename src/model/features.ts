// 기능: whether a provided feature is in a chat at all, set on any layer of the ladder 공용 → 프롬프트 → 캐릭터 → 채팅
// (runtime/features featuresOf). A layer's absent entry sets nothing there.
export const FEATURES = ['translate', 'illustrate', 'memory'] as const;
export type Feature = (typeof FEATURES)[number];
export type FeatureSwitches = Partial<Record<Feature, boolean>>;
