/**
 * §5 — Cognitive fatigue: the leaky-integrator channel model. ¶NOVEL
 *
 * Four cognitive resource channels each carry a saturation state Sat_j ∈ [0,1]
 * evolving as a leaky integrator — RC charge while a channel is under load,
 * exponential discharge while it is idle:
 *
 *     dSat_j/dt = (λ_ij / τ_j)·(1 − Sat_j) − Sat_j / ρ_j
 *
 * The fatigue penalty for a candidate skill is then a dot product: a skill costs
 * what it loads on channels that are already saturated. This is what lets the
 * scheduler prefer a guitar block after two hours of debugging without anyone
 * hand-coding "alternate between mental and physical" — the channel loadings and
 * the saturation state produce it.
 *
 * ## Evidence status — read before tuning
 *
 * §5 flags this ¶NOVEL and the flag is doing real work. The channel decomposition
 * is *motivated* by working-memory structure (Baddeley), dual coding (Paivio), and
 * modality effects in cognitive load theory. The vigilance and attention-residue
 * literature supports the existence of fatigue qualitatively but supplies **no
 * reliable time constants**. τ and ρ are therefore hyperparameters awaiting a fit,
 * not measurements, and nothing in this module may hard-code them: they arrive from
 * scheduler_config so that §11's ablation (β = 0 arm) and the eventual fit against
 * post-session self-reports and within-session latency drift are possible at all.
 *
 * ## Closed forms, no solver
 *
 * The ODE is only ever integrated over intervals where the load is constant — a
 * block on one skill, or an idle gap — so both cases have closed forms and the
 * controller stays cheap enough to re-evaluate on every attempt.
 */

/** Channel order is fixed everywhere: λ vectors, sat vectors, τ and ρ all use it. */
export const CHANNELS = ["logical", "verbal", "visual", "motor"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Saturation per channel, [0,1], in CHANNELS order. */
export type ChannelVector = readonly number[];

export interface FatigueConstants {
  /** τ_j — time-to-fatigue under full load, minutes. §5 init: 45–60. */
  tauMinutes: ChannelVector;
  /** ρ_j — recovery constant, minutes. §5 init: 60–90. */
  rhoMinutes: ChannelVector;
}

export const ZERO_SATURATION: ChannelVector = [0, 0, 0, 0];

/** Uniform loading, used until the §8 import pass supplies a real λ_i. */
export const UNIFORM_LOADING: ChannelVector = [0.25, 0.25, 0.25, 0.25];

function assertLength(v: ChannelVector, name: string): void {
  if (v.length !== CHANNELS.length) {
    throw new Error(`${name} must have ${CHANNELS.length} entries, got ${v.length}`);
  }
}

/**
 * Charge: saturation after practising skill `i` for `durationMinutes`.
 *
 *     Sat_j ← 1 − (1 − Sat_j)·exp(−λ_ij·d / τ_j)
 *
 * Note this saturates toward 1 and never exceeds it, however long the block runs —
 * which is the property that makes the penalty bounded and the utility comparison
 * stable. A channel the skill does not load (λ_ij = 0) is untouched.
 */
export function chargeAfterSession(
  sat: ChannelVector,
  loading: ChannelVector,
  durationMinutes: number,
  constants: FatigueConstants
): number[] {
  assertLength(sat, "sat");
  assertLength(loading, "loading");
  assertLength(constants.tauMinutes, "tauMinutes");
  if (durationMinutes <= 0) return [...sat];

  return sat.map((s, j) => {
    const tau = constants.tauMinutes[j];
    if (tau <= 0) return 1;
    const exponent = (-loading[j] * durationMinutes) / tau;
    return clamp01(1 - (1 - s) * Math.exp(exponent));
  });
}

/**
 * Discharge: saturation after `idleMinutes` with no load.
 *
 *     Sat_j ← Sat_j·exp(−Δ / ρ_j)
 *
 * Applied from the persisted timestamp rather than assumed — fatigue slept off and
 * fatigue from ten minutes ago are different states, and treating a returning
 * learner as though they carried yesterday's saturation would suppress exactly the
 * skills they are freshest for.
 */
export function decayAfterIdle(
  sat: ChannelVector,
  idleMinutes: number,
  constants: FatigueConstants
): number[] {
  assertLength(sat, "sat");
  assertLength(constants.rhoMinutes, "rhoMinutes");
  if (idleMinutes <= 0) return [...sat];

  return sat.map((s, j) => {
    const rho = constants.rhoMinutes[j];
    if (rho <= 0) return 0;
    return clamp01(s * Math.exp(-idleMinutes / rho));
  });
}

/**
 * F_i(t) = λ_i · Sat(t).
 *
 * Bounded by Σλ_ij, so a skill loading one channel at 1.0 and one loading four at
 * 0.25 each are on the same scale — which matters because β is a single global
 * weight in §7 and would otherwise mean different things for different skills.
 */
export function fatiguePenalty(loading: ChannelVector, sat: ChannelVector): number {
  assertLength(loading, "loading");
  assertLength(sat, "sat");
  let total = 0;
  for (let j = 0; j < CHANNELS.length; j++) total += loading[j] * sat[j];
  return total;
}

/**
 * Saturation brought forward to `now` from its last-persisted value.
 *
 * The single entry point the controller should use — it is the only place that
 * knows idle decay must be applied before the state means anything, and every
 * caller that reads user_channel_state directly would otherwise have to remember.
 */
export function currentSaturation(
  persisted: ChannelVector,
  persistedAt: Date,
  now: Date,
  constants: FatigueConstants
): number[] {
  const idleMinutes = (now.getTime() - persistedAt.getTime()) / 60000;
  return decayAfterIdle(persisted, idleMinutes, constants);
}

/**
 * Normalises an LLM-proposed channel loading onto the simplex.
 *
 * §8 has a language model assign λ_i at import. Left unnormalised, a model that
 * happens to emit larger numbers for one skill would make that skill permanently
 * more expensive than an identical one described differently — a scheduling
 * difference caused by prose style rather than cognition. Normalising makes F_i
 * comparable across skills, which is what a single global β requires.
 *
 * An all-zero proposal falls back to uniform rather than producing a
 * fatigue-immune skill that would dominate the argmax indefinitely.
 */
export function normaliseLoading(raw: readonly number[]): number[] {
  if (raw.length !== CHANNELS.length) return [...UNIFORM_LOADING];
  const clamped = raw.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const total = clamped.reduce((a, b) => a + b, 0);
  if (total <= 0) return [...UNIFORM_LOADING];
  return clamped.map((x) => x / total);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}
