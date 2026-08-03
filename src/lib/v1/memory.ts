/**
 * §3 — Retrievability and the stability update.
 *
 * ## Units: resolving a contradiction in the spec
 *
 * §2 defines S_i operationally as "the Δt at which R_i = 0.9", explicitly
 * "decay-form-agnostic". §3 then writes R_i(t) = exp(−Δt / S_i). These cannot both
 * be true: under exp(−Δt/S), R reaches 0.9 at Δt = 0.105·S, not at S.
 *
 * We keep §2's operational definition, because §3's own stated reason for having one
 * is that the functional form must be swappable in v2 without invalidating stored
 * parameters — and that only works if S is defined by an observable (time to a given
 * recall probability) rather than by the internals of whichever curve is current. So
 * throughout this codebase:
 *
 *     S = days until R decays to 0.9
 *     R(Δt) = 0.9 ^ (Δt / S)     ≡     exp(−Δt · ln(1/0.9) / S)
 *
 * which is the same exponential family §3 asks for, parameterised by the operational
 * quantity §2 defines. When v2 replaces the curve with an HLR fit or a power law, S
 * keeps meaning exactly what it meant and stored values survive.
 *
 * ## Known limitation, inherited deliberately
 *
 * §3 is explicit that empirical forgetting is better fit by a power law — a
 * superposition of heterogeneous exponentials yields power-law population behaviour,
 * and FSRS itself uses R = (1 + F·Δt/S)^(−c). The exponential is retained in v1 for
 * closed-form convenience in the controller, and the operational definition of S is
 * precisely what makes that a deferrable decision rather than a trap.
 *
 * ## The ¶NOVEL caveat this module cannot resolve on its own
 *
 * Every validated decay model targets discrete memorised items. Applying one to a
 * skill-level construct is an assumption to be tested, not inherited. The prompt
 * layer (see prompts.ts) narrows the gap — the system is pooling items under a skill
 * node rather than modelling a fuzzy construct directly — but it does not close it.
 * Per-prompt calibration curves are the test; see calibration.ts.
 */

import type { Grade } from "./grade";
import { isLapse } from "./grade";

export type { Grade };

/** ln(1/0.9). The conversion between operational S and the raw exponential scale. */
const LN_INV_09 = Math.log(1 / 0.9);

/**
 * FSRS-style priors, used to initialise a skill that has never been reviewed.
 *
 * These are starting points exposed for per-user scaling, exactly as §3 requires,
 * not tuned constants. Nothing in v1 has been fit to data — that is what v2 is for.
 */
export const PRIORS = {
  /** Initial S by first grade, in days-to-R=0.9. A first `again` still leaves a
   *  trace: the item was encoded, just not durably. */
  initialStability: { again: 0.4, hard: 1.2, good: 3.0, easy: 8.0 } as Record<Grade, number>,
  /** Difficulty runs [1,10], higher is harder. A `good` first attempt sits mid-scale. */
  initialDifficulty: { again: 7.5, hard: 6.0, good: 5.0, easy: 3.5 } as Record<Grade, number>,
  /** Multiplier ceiling on a single successful update — stops one lucky retrieval
   *  from launching an item months into the future. */
  maxStabilityGain: 12,
  /** Floor and ceiling on S in days. The floor keeps R computable; the ceiling
   *  reflects that we have no evidence for predictions beyond a few years. */
  minStability: 0.05,
  maxStability: 3650,
  /** Fraction of prior stability retained through a lapse. Not zero: relearning a
   *  once-known item is faster than learning it cold, and collapsing to the initial
   *  value would throw that away. */
  lapseRetention: 0.28,
  /** Difficulty step per grade, and the mean-reversion pull toward the centre that
   *  keeps a single bad session from permanently branding an item as hard. */
  difficultyStep: 0.9,
  difficultyReversion: 0.08,
} as const;

export interface MemoryState {
  /** Days until R decays to 0.9. Null when never reviewed. */
  stability: number | null;
  /** FSRS-style item difficulty on [1,10]; higher is harder. */
  difficulty: number;
}

/**
 * R_i(t) — probability of successful retrieval right now.
 *
 * Returns 0 for a never-reviewed skill: there is no memory trace to retrieve, which
 * is different from a decayed one and must not be conflated with it.
 */
export function retrievability(elapsedDays: number, stability: number | null): number {
  if (stability === null || stability <= 0) return 0;
  if (elapsedDays <= 0) return 1;
  return Math.exp((-elapsedDays * LN_INV_09) / stability);
}

/**
 * Inverse of {@link retrievability}: days from the last review until R falls to a
 * given level. Used for "when will this need attention" copy and for the reminder
 * cron, both of which otherwise invent their own arithmetic and disagree.
 */
export function daysUntilRetrievability(
  target: number,
  stability: number | null
): number | null {
  if (stability === null || stability <= 0) return null;
  if (target <= 0 || target >= 1) return null;
  return (stability * Math.log(1 / target)) / LN_INV_09;
}

/**
 * The stability update.
 *
 * The spacing effect is the load-bearing part: a successful retrieval produces a
 * *larger* stability gain the lower R was when it happened. Retrieving something you
 * were about to forget teaches more than retrieving something you already had. This
 * is why the `(1 - R)` term appears in the gain and why an easy review of a fresh
 * item barely moves the number — and it is the mechanism the whole §4 urgency
 * function exists to exploit.
 *
 * On a lapse, stability collapses toward a relearning value rather than to zero:
 * the item is not new, and treating it as new discards real information.
 *
 * @param state       current stability/difficulty; stability null = never reviewed
 * @param r           retrievability at the moment of retrieval
 * @param grade       forced 4-point outcome
 */
export function updateStability(state: MemoryState, r: number, grade: Grade): number {
  const { stability, difficulty } = state;

  // First review: no prior trace, so the priors set the scale.
  if (stability === null) {
    return clampStability(PRIORS.initialStability[grade]);
  }

  if (isLapse(grade)) {
    // Harder items lose more through a lapse; the difficulty term spans roughly
    // [0.7, 1.3] of the base retention across the [1,10] scale.
    const difficultyFactor = 1.3 - 0.06 * (difficulty - 1);
    return clampStability(stability * PRIORS.lapseRetention * difficultyFactor);
  }

  // Success. Three multiplicative influences, all bounded:
  //   - retrievability: the spacing effect. (1 - r) is near 0 for a too-early
  //     review and near 1 for one made at the edge of forgetting.
  //   - difficulty: hard items consolidate more slowly.
  //   - grade: `hard` is a success, but a grudging one.
  const spacingBonus = 1 + 10 * (1 - r);
  const difficultyFactor = 1.2 - 0.045 * (difficulty - 1); // ≈1.2 at d=1, ≈0.8 at d=10
  const gradeFactor = grade === "hard" ? 0.6 : grade === "easy" ? 1.35 : 1.0;

  const gain = 1 + (spacingBonus - 1) * difficultyFactor * gradeFactor * 0.28;
  return clampStability(stability * Math.min(gain, PRIORS.maxStabilityGain));
}

/**
 * The difficulty update.
 *
 * Two forces: a step in the direction the grade indicates, and a gentle reversion
 * toward the centre of the scale. The reversion matters — without it a single bad
 * session permanently brands an item as hard, and difficulty ratchets in one
 * direction over a long history because failures are more salient than successes.
 */
export function updateDifficulty(state: MemoryState, grade: Grade): number {
  if (state.stability === null) {
    return clampDifficulty(PRIORS.initialDifficulty[grade]);
  }
  // again +2 steps, hard +1, good 0, easy −1 (before reversion).
  const delta = { again: 2, hard: 1, good: 0, easy: -1 }[grade];
  const stepped = state.difficulty + PRIORS.difficultyStep * delta;
  const reverted =
    stepped + PRIORS.difficultyReversion * (PRIORS.initialDifficulty.good - stepped);
  return clampDifficulty(reverted);
}

/** Applies both updates together — the only way callers should advance state. */
export function applyReview(
  state: MemoryState,
  elapsedDays: number,
  grade: Grade
): { next: MemoryState; rPred: number } {
  const rPred = retrievability(elapsedDays, state.stability);
  // Difficulty is computed from the PRE-review state, so both updates see the same
  // starting point rather than the stability update silently reading a new difficulty.
  const difficulty = updateDifficulty(state, grade);
  const stability = updateStability(state, rPred, grade);
  return { next: { stability, difficulty }, rPred };
}

function clampStability(s: number): number {
  if (!Number.isFinite(s)) return PRIORS.maxStability;
  return Math.min(PRIORS.maxStability, Math.max(PRIORS.minStability, s));
}

function clampDifficulty(d: number): number {
  if (!Number.isFinite(d)) return PRIORS.initialDifficulty.good;
  return Math.min(10, Math.max(1, d));
}

/**
 * Days of stability at which mastery reads 0.5. Sole parameter of the curve below;
 * at this value mastery(365) ≈ 0.9, so "a year of retention" is near-mastered
 * without ever being exactly mastered.
 */
export const HALF_MASTERY_DAYS = 40;

/**
 * Mastery proxy on [0,1), for §6's soft readiness.
 *
 * §6 asks for "mastery proxied by stability quantile". Two deliberate departures:
 *
 * **Absolute, not quantile.** A quantile is relative to the learner's own skill
 * set, so someone whose skills are uniformly weak would have their least-weak skill
 * read as fully mastered — and prerequisite gating would then unlock material
 * nobody is ready for. Readiness has to mean something about the memory, not about
 * the peer group.
 *
 * **Asymptotic, not clamped.** A saturating curve rather than a squash-and-clamp,
 * so the function is strictly monotonic everywhere. A hard ceiling would make an
 * item held for a year and one held for a decade identical inputs to the gate,
 * which throws away a real difference for no benefit and puts a discontinuity in
 * the middle of the range the controller reads.
 */
export function masteryFromStability(stability: number | null): number {
  if (stability === null || stability <= 0) return 0;
  return stability / (stability + HALF_MASTERY_DAYS);
}
