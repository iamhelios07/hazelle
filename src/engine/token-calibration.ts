import type { TokenEstimate, TokenFit, TokenLimits } from '../model/token-calibration';

export type Moments = { w: number; sum: number; squares: number };
export type Prior = { m: number; k: number; a: number; b: number };
export type Posterior = Prior & { scale: number; variance: number };
export const emptyMoments = (): Moments => ({ w: 0, sum: 0, squares: 0 });
// A model-independent policy median, not a count-endpoint measurement or a model-name default.
export const GLOBAL_PRIOR: Prior = { m: Math.log(1.30), k: 0.36, a: 2, b: 0.15 ** 2 };
const FLOOR = 0.02 ** 2;
const DAY = 86_400_000;

export function decay(moments: Moments, steps: number, days: number, halfLife: number): Moments {
  const factor = 2 ** (-steps / halfLife - Math.max(0, days) / 30);
  return { w: moments.w * factor, sum: moments.sum * factor, squares: moments.squares * factor };
}

export function add(moments: Moments, y: number, weight = 1): Moments {
  return { w: moments.w + weight, sum: moments.sum + weight * y, squares: moments.squares + weight * y * y };
}

export function posterior(prior: Prior, { w, sum, squares }: Moments): Posterior {
  const k = prior.k + w;
  const m = (prior.k * prior.m + sum) / k;
  const a = prior.a + w / 2;
  const b = prior.b + (w > 0 ? Math.max(0, squares - sum * sum / w) / 2 + prior.k * w / (2 * k) * (sum / w - prior.m) ** 2 : 0);
  const scale = Math.sqrt(Math.max(b / a, FLOOR) * (1 + 1 / k));
  return { m, k, a, b, scale, variance: scale * scale * a / (a - 1) };
}

export function centres(p: Posterior) {
  // exp(m) is the median, not expected spend. The Student-t exponential moment is infinite;
  // cost fitting uses a moment-matched lognormal, while the hard bound retains the Student-t tail.
  return { centre: Math.exp(p.m + p.variance / 2), upper: Math.exp(p.m + studentQuantile(0.99, 2 * p.a) * p.scale) };
}

export function fitLimits(limits: TokenLimits, estimate: TokenEstimate): TokenFit {
  const base: TokenFit = { source: estimate.source, evidence: estimate.evidence, bound: null, multiplier: null, allowance: null, inputLimit: null, epsilon: 0.01 };
  const candidates: TokenFit[] = [];
  const withLimit = (context: number, multiplier: number, bound: TokenFit['bound']) => {
    const inputLimit = Math.max(0, context - limits.output);
    candidates.push({ ...base, bound, multiplier, inputLimit, allowance: Math.floor(inputLimit / multiplier) });
  };
  if (limits.hard !== null) withLimit(limits.hard, estimate.cold ? estimate.centre : estimate.upper, estimate.cold ? 'hard-centre' : 'hard-upper');
  if (limits.user !== null && (limits.hard === null || limits.user < limits.hard)) withLimit(limits.user, estimate.centre, 'user-centre');
  return candidates.reduce((best, next) => best.allowance === null || next.allowance! < best.allowance ? next : best, base);
}

type Clocked = Moments & { at: number; step: number };
type Local = { stats: Clocked; contribution: Clocked; guard: number; last: string; pending: { y: number; direction: number } | null; reset: boolean };
type ModelState = { stats: Clocked; step: number; chats: Map<string, Local>; last: string; guard: number };
export type Observation = { key: string; chat: string | null; at: number; fingerprint: string; input: number; denominator: number };
const clocked = (): Clocked => ({ ...emptyMoments(), at: 0, step: 0 });
const advance = (stats: Clocked, step: number, at: number, half: number): Clocked => ({ ...decay(stats, step - stats.step, (at - stats.at) / DAY, half), step, at });

export class Calibration {
  private readonly models = new Map<string, ModelState>();

  observe(observation: Observation) {
    const { key, chat, at, input, denominator, fingerprint } = observation;
    if (!(input > 0 && denominator > 0 && Number.isFinite(input) && Number.isFinite(denominator))) return;
    let model = this.models.get(key);
    if (!model) { model = { stats: clocked(), step: 0, chats: new Map(), last: '', guard: -Infinity }; this.models.set(key, model); }
    const print = `${fingerprint}:${input}:${denominator}`;
    if (model.last === print) return;
    model.last = print;
    const y = Math.log(input / denominator);
    const local = chat === null ? undefined : model.chats.get(chat);
    const parent = this.parent(model, local, at);
    if (chat !== null) {
      const held = local ?? { stats: clocked(), contribution: clocked(), guard: -Infinity, last: '', pending: null, reset: false };
      if (held.last === print) return;
      held.last = print;
      const prior = this.chatPrior(parent);
      const stats = advance(held.stats, held.stats.step + 1, at, 16);
      const before = posterior(prior, stats);
      const error = y - before.m;
      const deviation = Math.sqrt(before.variance);
      const weight = Math.min(1, 3 * deviation / Math.max(Math.abs(error), Number.EPSILON));
      const direction = Math.abs(error) > Math.max(Math.log(1.10), 3 * deviation) ? Math.sign(error) : 0;
      if (direction && held.pending?.direction === direction) {
        held.stats = { ...add(add(emptyMoments(), held.pending.y), y), at, step: stats.step };
        held.guard = Math.max(held.pending.y, y);
        held.pending = null;
        held.reset = true;
      } else {
        held.stats = { ...add(stats, y, weight), at, step: stats.step };
        held.guard = Math.max(y, held.guard - Math.log(1.10) / 16);
        held.pending = direction ? { y, direction } : null;
      }
      model.chats.set(chat, held);
    }
    model.guard = Math.max(y, model.guard - Math.log(1.10) / 16);
    model.step++;
    const stats = advance(model.stats, model.step, at, 64);
    const before = posterior(GLOBAL_PRIOR, stats);
    const weight = Math.min(1, 3 * Math.sqrt(before.variance) / Math.max(Math.abs(y - before.m), Number.EPSILON));
    model.stats = { ...add(stats, y, weight), at, step: model.step };
    if (chat !== null) {
      const held = model.chats.get(chat)!;
      held.contribution = { ...add(advance(held.contribution, model.step, at, 64), y, weight), at, step: model.step };
    }
  }

  invalidate(key: string, chat: string | null, at: number) {
    const model = this.models.get(key);
    if (!model) return;
    model.last = '';
    if (chat === null) {
      model.stats = { ...emptyMoments(), at, step: model.step };
      for (const local of model.chats.values()) local.contribution = { ...emptyMoments(), at, step: model.step };
      return;
    }
    const local = model.chats.get(chat);
    if (!local) return;
    // A count-free refusal removes confidence, not an invented ratio or the last valid high-count guard.
    local.stats = { ...emptyMoments(), at, step: local.stats.step };
    local.pending = null;
    local.last = '';
    local.reset = true;
  }

  estimate(key: string, chat: string | null, at: number): TokenEstimate {
    const model = this.models.get(key);
    if (!model) return { ...centres(posterior(GLOBAL_PRIOR, emptyMoments())), source: 'prior', evidence: 0, cold: true };
    const local = chat === null ? undefined : model.chats.get(chat);
    const parent = this.parent(model, local, at);
    if (!local) {
      const p = chat === null ? parent : posterior(this.chatPrior(parent), emptyMoments());
      const values = centres(p);
      return { ...values, upper: chat === null ? Math.max(values.upper, Math.exp(model.guard)) : values.upper, source: 'model', evidence: advance(model.stats, model.step, at, 64).w, cold: chat !== null };
    }
    const stats = advance(local.stats, local.stats.step, at, 16);
    const p = posterior(this.chatPrior(parent), stats);
    const values = centres(p);
    return { centre: values.centre, upper: Math.max(values.upper, Math.exp(local.guard)), source: local.reset ? 'drift-reset' : 'chat', evidence: stats.w, cold: false };
  }

  private parent(model: ModelState, local: Local | undefined, at: number): Posterior {
    const total = advance(model.stats, model.step, at, 64);
    const own = local ? advance(local.contribution, model.step, at, 64) : emptyMoments();
    const w = Math.max(0, total.w - own.w);
    return posterior(GLOBAL_PRIOR, w < 1e-10 ? emptyMoments() : { w, sum: total.sum - own.sum, squares: total.squares - own.squares });
  }

  private chatPrior(parent: Posterior): Prior {
    const uncertainty = parent.b / ((parent.a - 1) * parent.k);
    return { m: parent.m, a: 2, b: FLOOR, k: FLOOR / (0.15 ** 2 + uncertainty) };
  }
}

// Invert the regularized incomplete beta CDF; discounted evidence makes degrees of freedom nonintegral.
export function studentQuantile(probability: number, degrees: number): number {
  if (!(probability > 0 && probability < 1 && degrees > 0)) throw new RangeError('student-quantile');
  if (probability < 0.5) return -studentQuantile(1 - probability, degrees);
  if (probability === 0.5) return 0;
  const cdf = (t: number) => 1 - betaRegularized(degrees / (degrees + t * t), degrees / 2, 0.5) / 2;
  let low = 0;
  let high = 1;
  while (cdf(high) < probability) high *= 2;
  for (let i = 0; i < 70; i++) {
    const middle = (low + high) / 2;
    if (cdf(middle) < probability) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}

function logGamma(z: number): number {
  const coefficients = [676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  z--;
  let x = 0.9999999999998099;
  for (let i = 0; i < coefficients.length; i++) x += coefficients[i]! / (z + i + 1);
  const t = z + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function betaRegularized(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  if (x > (a + 1) / (a + b + 2)) return 1 - betaRegularized(1 - x, b, a);
  const front = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log1p(-x));
  const safe = (v: number) => Math.abs(v) < 1e-30 ? 1e-30 : v;
  let c = 1;
  let d = 1 / safe(1 - (a + b) * x / (a + 1));
  let h = d;
  for (let m = 1; m <= 200; m++) {
    for (const fraction of [m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m)), -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1))]) {
      d = 1 / safe(1 + fraction * d);
      c = safe(1 + fraction / c);
      const delta = d * c;
      h *= delta;
      if (fraction < 0 && Math.abs(delta - 1) < 1e-13) return front * h / a;
    }
  }
  return front * h / a;
}
