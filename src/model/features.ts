// 기능: whether a provided feature is in a chat at all, set on any layer of the ladder 공용 → 프롬프트 → 캐릭터 → 채팅
// (runtime/features featuresOf). A layer's absent entry sets nothing there.
export const FEATURES = ['translate', 'illustrate', 'memory', 'mascot'] as const;
export type Feature = (typeof FEATURES)[number];
export type FeatureSwitches = Partial<Record<Feature, boolean>>;

// What a feature no layer sets reads. 마스코트 starts off: it costs one more 보조 call per reply (design §6.11).
export const FEATURE_STARTS: Record<Feature, boolean> = { translate: true, illustrate: true, memory: true, mascot: false };
