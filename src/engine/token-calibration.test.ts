import { expect, it } from 'vitest';
import { add, Calibration, centres, decay, emptyMoments, fitLimits, GLOBAL_PRIOR, posterior, studentQuantile } from './token-calibration';

it('matches weighted batch posterior arithmetic', () => {
  const moments = add(add(emptyMoments(), 0.1, 0.5), 0.3, 2);
  expect(moments).toEqual({ w: 2.5, sum: 0.65, squares: 0.185 });
  const p = posterior({ m: 0, k: 1, a: 2, b: 0.1 }, moments);
  expect(p.m).toBeCloseTo(0.65 / 3.5, 12);
  expect(p.b).toBeCloseTo(0.1 + (0.185 - 0.65 ** 2 / 3.5) / 2, 12);
});

it('halves evidence with either the observation or wall-time half-life', () => {
  const moments = { w: 10, sum: 2, squares: 0.5 };
  expect(decay(moments, 16, 0, 16)).toEqual({ w: 5, sum: 1, squares: 0.25 });
  expect(decay(moments, 0, 30, 64)).toEqual(decay(moments, 64, 0, 64));
});

it('matches Student-t reference quantiles including fractional degrees and keeps predictive variation', () => {
  expect(studentQuantile(0.99, 4)).toBeCloseTo(3.746947387981, 9);
  expect(studentQuantile(0.975, 10)).toBeCloseTo(2.228138851965, 9);
  expect(studentQuantile(0.99, 4.5)).toBeCloseTo(3.52705089, 6);
  const p = posterior(GLOBAL_PRIOR, { w: 10000, sum: 0, squares: 0 });
  expect(centres(p).upper).toBeGreaterThan(Math.exp(p.m + 0.04));
});

const observation = (at: number, input = 130, chat: string | null = 'chat') => ({ key: 'route', chat, at, input, denominator: 100, fingerprint: String(at) });

it('uses a model-independent cold centre and the lognormal mean for expected spend', () => {
  const calibration = new Calibration();
  const estimate = calibration.estimate('unknown', 'chat', 0);
  expect(estimate).toMatchObject({ cold: true, source: 'prior', evidence: 0 });
  expect(estimate.centre).toBeCloseTo(1.30 * Math.exp(0.085 / 2), 12);
  expect(estimate.centre).toBeLessThan(1.4);
  expect(fitLimits({ hard: 1000, user: null, output: 100 }, estimate)).toMatchObject({ bound: 'hard-centre', allowance: Math.floor(900 / estimate.centre) });
});

it('excludes the current chat from its parent and leaves uncertainty for an unseen chat', () => {
  const calibration = new Calibration();
  for (let i = 0; i < 64; i++) calibration.observe(observation(i, 110));
  const known = calibration.estimate('route', 'chat', 64);
  const unseen = calibration.estimate('route', 'new', 64);
  expect(known.source).toBe('chat');
  expect(unseen).toMatchObject({ source: 'model', cold: true });
  expect(unseen.upper / unseen.centre).toBeGreaterThan(known.upper / known.centre);
  const one = new Calibration();
  one.observe(observation(0, 200));
  expect(one.estimate('route', 'chat', 0).centre).toBeGreaterThan(1.9);
});

it('rejects invalid observations and deduplicates repeated prompts but learns changed counts', () => {
  const calibration = new Calibration();
  calibration.observe(observation(0, NaN));
  expect(calibration.estimate('route', 'chat', 0).source).toBe('prior');
  calibration.observe(observation(1));
  const first = calibration.estimate('route', 'chat', 1);
  calibration.observe({ ...observation(2), fingerprint: '1' });
  expect(calibration.estimate('route', 'chat', 1)).toEqual(first);
  calibration.observe({ ...observation(3, 150), fingerprint: '1' });
  expect(calibration.estimate('route', 'chat', 3).evidence).toBeGreaterThan(first.evidence);
});

it('guards valid high counts and resets on a consecutive upward drift', () => {
  const calibration = new Calibration();
  for (let i = 0; i < 64; i++) calibration.observe(observation(i, 115));
  calibration.observe(observation(64, 147));
  expect(calibration.estimate('route', 'chat', 64).upper).toBeGreaterThanOrEqual(1.47);
  calibration.observe(observation(65, 147));
  expect(calibration.estimate('route', 'chat', 65)).toMatchObject({ source: 'drift-reset', evidence: 2 });
});

it('fits the smaller native allowance after output reservation and never scales authored output', () => {
  const estimate = { source: 'chat' as const, evidence: 10, centre: 1.2, upper: 1.5, cold: false };
  expect(fitLimits({ hard: 1000, user: 900, output: 100 }, estimate)).toMatchObject({ bound: 'hard-upper', allowance: 600, multiplier: 1.5 });
  expect(fitLimits({ hard: 1000, user: 700, output: 100 }, estimate)).toMatchObject({ bound: 'user-centre', allowance: 500, multiplier: 1.2 });
  expect(fitLimits({ hard: null, user: 700, output: 100 }, estimate).allowance).toBe(500);
  expect(fitLimits({ hard: null, user: null, output: 100 }, estimate).allowance).toBeNull();
  expect(fitLimits({ hard: 1000, user: 2000, output: 100 }, estimate).bound).toBe('hard-upper');
});
