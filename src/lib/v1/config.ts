/**
 * §7 hyperparameters.
 *
 * Every value here is data, not a constant, and that is a design requirement rather
 * than flexibility for its own sake:
 *
 *   - §7 names all of them as candidates for bandit-style tuning post-launch.
 *   - §11 requires ε to be *randomised across users* for the block-granularity
 *     experiment — the most direct test of the cross-domain switching claim.
 *   - §11 also requires a β = 0 arm to ablate the fatigue term, which is impossible
 *     if β is compiled in.
 *   - τ and ρ have no reliable values in the literature at all (§5) and exist to be
 *     fitted against self-reports and latency drift.
 *
 * The defaults below are the v1 values from §7. They are starting points that no
 * data has yet touched, and the code should never read as though they were tuned.
 */

import type { FatigueConstants } from "./fatigue";

export interface SchedulerConfig {
  /** α — urgency weight. */
  alpha: number;
  /** β — fatigue weight. Set to 0 for §11's ablation arm. */
  beta: number;
  /** γ — readiness weight. */
  gamma: number;
  /** δ — interference weight. Set to 0 for §11's interference A/B control. */
  delta: number;
  /**
   * ε — hysteresis margin, and the *sole* control on block granularity.
   *
   * There is no block-duration parameter anywhere in this system. Small ε yields
   * rapid interleaving; large ε yields long focused blocks. Session length is
   * emergent: a block lasts exactly as long as it takes fatigue accumulation and
   * urgency drift to overcome this number.
   */
  epsilon: number;
  /** θ — target retrievability for the desirable-difficulty band. */
  theta: number;
  /** σ — tolerance of that band. */
  sigma: number;
  fatigue: FatigueConstants;
  simThreshold: number;
  simDegreeCap: number;
  /** w — interference window, in blocks. */
  interferenceWindow: number;
}

export const DEFAULT_CONFIG: SchedulerConfig = {
  alpha: 1.0,
  beta: 0.7,
  gamma: 0.5,
  delta: 0.3,
  epsilon: 0.15,
  theta: 0.35,
  sigma: 0.15,
  fatigue: {
    tauMinutes: [50, 50, 50, 50],
    rhoMinutes: [75, 75, 75, 75],
  },
  simThreshold: 0.6,
  simDegreeCap: 10,
  interferenceWindow: 1,
};

/** Shape of a `scheduler_config` row as it comes back from PostgREST. */
export interface SchedulerConfigRow {
  alpha: number | string;
  beta: number | string;
  gamma: number | string;
  delta: number | string;
  epsilon: number | string;
  theta: number | string;
  sigma: number | string;
  tau_minutes: Array<number | string>;
  rho_minutes: Array<number | string>;
  sim_threshold: number | string;
  sim_degree_cap: number | string;
}

/**
 * Postgres `numeric` arrives over PostgREST as a *string* — it is arbitrary
 * precision and JSON numbers are not. Left uncoerced, `alpha * urgency` becomes
 * string concatenation or NaN, and the scheduler silently produces nonsense rather
 * than failing. Every field is therefore parsed explicitly.
 */
export function configFromRow(row: Partial<SchedulerConfigRow> | null): SchedulerConfig {
  if (!row) return DEFAULT_CONFIG;
  const num = (v: number | string | undefined, fallback: number): number => {
    if (v === undefined || v === null) return fallback;
    const parsed = typeof v === "number" ? v : Number.parseFloat(v);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const arr = (
    v: Array<number | string> | undefined,
    fallback: readonly number[]
  ): number[] => {
    if (!Array.isArray(v) || v.length !== fallback.length) return [...fallback];
    const parsed = v.map((x) => num(x, NaN));
    return parsed.some((x) => !Number.isFinite(x)) ? [...fallback] : parsed;
  };

  return {
    alpha: num(row.alpha, DEFAULT_CONFIG.alpha),
    beta: num(row.beta, DEFAULT_CONFIG.beta),
    gamma: num(row.gamma, DEFAULT_CONFIG.gamma),
    delta: num(row.delta, DEFAULT_CONFIG.delta),
    epsilon: num(row.epsilon, DEFAULT_CONFIG.epsilon),
    theta: num(row.theta, DEFAULT_CONFIG.theta),
    sigma: num(row.sigma, DEFAULT_CONFIG.sigma),
    fatigue: {
      tauMinutes: arr(row.tau_minutes, DEFAULT_CONFIG.fatigue.tauMinutes),
      rhoMinutes: arr(row.rho_minutes, DEFAULT_CONFIG.fatigue.rhoMinutes),
    },
    simThreshold: num(row.sim_threshold, DEFAULT_CONFIG.simThreshold),
    simDegreeCap: num(row.sim_degree_cap, DEFAULT_CONFIG.simDegreeCap),
    interferenceWindow: DEFAULT_CONFIG.interferenceWindow,
  };
}
