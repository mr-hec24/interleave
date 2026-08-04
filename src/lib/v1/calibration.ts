/**
 * §11 — calibration curves.
 *
 * The system predicts a recall probability before every retrieval and observes an
 * outcome after it. Calibration asks the only question that makes those predictions
 * worth anything: when it said 70%, did roughly 70% come back?
 *
 * ## Why this is the ¶NOVEL test, not just a dashboard
 *
 * §3 flags the central unvalidated assumption: every decay model that has been
 * validated targets *discrete memorised items*, and applying one to a skill-level
 * construct — a scale, a debugging pattern — is an assumption this system must test
 * rather than inherit. The prompt layer narrows that gap by pooling items under a
 * skill node, but pooling is only honest if the items in a pool actually behave
 * alike.
 *
 * That is directly measurable here. Compute a curve per skill, and a curve per cue
 * within it. If the cues in one pool diverge — one reliably failing at a predicted R
 * where its siblings succeed — then the skill's single stability estimate is an
 * average over heterogeneous items, and the skill is scoped too broadly. §3 of
 * `docs/research-synthesis.md` argues for narrow scoping as a measurement
 * requirement; this is what turns that argument into a number.
 *
 * ## What a bad result looks like
 *
 * Nothing here is designed to flatter the model. A well-calibrated system sits on
 * the diagonal; systematic deviation above it means the model is pessimistic, below
 * it means overconfident, and either is a finding. Because the scheduler's decisions
 * are driven by R, calibration error compounds into scheduling error — §8 makes the
 * same point for v2, that a calibrated mediocre model beats a sharp miscalibrated
 * one.
 */

import { isLapse, type Grade } from "./grade";

/** One logged retrieval: what was predicted, and what happened. */
export interface CalibrationObservation {
  skillId: string;
  promptRef: string | null;
  rPred: number;
  grade: Grade;
  ts: Date;
  /** Rows from before the measurement layer existed. Excluded by default. */
  schedulerVersion: string;
}

export interface CalibrationBin {
  /** Inclusive lower edge of the predicted-R band. */
  lower: number;
  upper: number;
  /** Mean predicted R of the observations that landed here. */
  meanPredicted: number;
  /** Fraction that were successful retrievals. */
  observedRate: number;
  count: number;
}

export interface CalibrationCurve {
  bins: CalibrationBin[];
  count: number;
  /**
   * Expected Calibration Error — the count-weighted mean gap between predicted and
   * observed across bins. 0 is perfect; positive numbers are the average size of
   * the model's mistake, in probability.
   */
  ece: number;
  /**
   * Signed mean gap (observed − predicted). Positive means the model is
   * *pessimistic* (things came back more often than predicted); negative means
   * overconfident. ECE alone can't tell those apart, and they call for opposite
   * corrections.
   */
  bias: number;
}

/**
 * A retrieval "succeeded" iff it was not a lapse.
 *
 * The binarisation is what makes calibration computable against a probability at
 * all, and it is lossy: `hard` and `easy` both count as successes here even though
 * they are very different retrievals. §8 binarises the same way for v2's HLR
 * training, so keeping it consistent means a curve computed today and a model
 * trained later are measuring the same event.
 */
export function wasSuccessful(grade: Grade): boolean {
  return !isLapse(grade);
}

export interface CalibrationOptions {
  /** Bin edges over predicted R. Defaults to deciles. */
  binCount?: number;
  /** Bins below this are reported but flagged; see `reliableBins`. */
  minBinCount?: number;
  /**
   * Include rows written before the measurement layer existed. Off by default:
   * those grades were made against no recorded cue, so treating them as item
   * responses would contaminate the very thing being measured.
   */
  includePreMeasurement?: boolean;
}

const DEFAULTS = { binCount: 10, minBinCount: 5 };

export function calibrationCurve(
  observations: readonly CalibrationObservation[],
  options: CalibrationOptions = {}
): CalibrationCurve {
  const binCount = options.binCount ?? DEFAULTS.binCount;
  const usable = options.includePreMeasurement
    ? observations
    : observations.filter((o) => o.schedulerVersion === "v1");

  const buckets: CalibrationObservation[][] = Array.from({ length: binCount }, () => []);
  for (const o of usable) {
    if (!Number.isFinite(o.rPred)) continue;
    const clamped = Math.min(0.999999, Math.max(0, o.rPred));
    buckets[Math.floor(clamped * binCount)].push(o);
  }

  const bins: CalibrationBin[] = [];
  let weightedError = 0;
  let weightedBias = 0;
  let total = 0;

  for (let i = 0; i < binCount; i++) {
    const rows = buckets[i];
    if (rows.length === 0) continue;
    const meanPredicted = rows.reduce((a, o) => a + o.rPred, 0) / rows.length;
    const observedRate =
      rows.filter((o) => wasSuccessful(o.grade)).length / rows.length;

    bins.push({
      lower: i / binCount,
      upper: (i + 1) / binCount,
      meanPredicted,
      observedRate,
      count: rows.length,
    });

    weightedError += rows.length * Math.abs(observedRate - meanPredicted);
    weightedBias += rows.length * (observedRate - meanPredicted);
    total += rows.length;
  }

  return {
    bins,
    count: total,
    ece: total === 0 ? 0 : weightedError / total,
    bias: total === 0 ? 0 : weightedBias / total,
  };
}

/** Bins with enough observations to mean anything. */
export function reliableBins(
  curve: CalibrationCurve,
  minBinCount = DEFAULTS.minBinCount
): CalibrationBin[] {
  return curve.bins.filter((b) => b.count >= minBinCount);
}

export interface PoolHeterogeneity {
  skillId: string;
  /** Per-cue observed success rate, for cues with enough data. */
  perPrompt: Array<{ promptRef: string; observedRate: number; count: number }>;
  /**
   * Spread between the best- and worst-performing cue in the pool. Large values
   * mean the pool is not behaving like one item.
   */
  spread: number;
  /** True when the spread exceeds the threshold and there is enough data to say so. */
  misScoped: boolean;
}

/**
 * The mis-scoping detector.
 *
 * This is the concrete form of §3's skill-vs-item caveat. If cues under one skill
 * show systematically different success rates at comparable predicted R, the skill
 * is a bag of heterogeneous items wearing one forgetting curve, and the single
 * stability estimate the scheduler holds for it is an average that describes none
 * of them.
 *
 * The recommended action is to split the skill — which is also the advice §3 of the
 * design doc gives on scoping, now triggered by evidence rather than by exhortation.
 */
export function poolHeterogeneity(
  skillId: string,
  observations: readonly CalibrationObservation[],
  options: { minPromptCount?: number; spreadThreshold?: number } = {}
): PoolHeterogeneity {
  const minPromptCount = options.minPromptCount ?? 5;
  const spreadThreshold = options.spreadThreshold ?? 0.4;

  const byPrompt = new Map<string, CalibrationObservation[]>();
  for (const o of observations) {
    if (o.skillId !== skillId || !o.promptRef) continue;
    if (o.schedulerVersion !== "v1") continue;
    const existing = byPrompt.get(o.promptRef);
    if (existing) existing.push(o);
    else byPrompt.set(o.promptRef, [o]);
  }

  const perPrompt = [...byPrompt.entries()]
    .filter(([, rows]) => rows.length >= minPromptCount)
    .map(([promptRef, rows]) => ({
      promptRef,
      observedRate: rows.filter((o) => wasSuccessful(o.grade)).length / rows.length,
      count: rows.length,
    }))
    .sort((a, b) => a.observedRate - b.observedRate);

  // A spread needs at least two cues with data; one cue is a skill with nothing to
  // compare against, not a homogeneous pool.
  const spread =
    perPrompt.length < 2
      ? 0
      : perPrompt[perPrompt.length - 1].observedRate - perPrompt[0].observedRate;

  return {
    skillId,
    perPrompt,
    spread,
    misScoped: perPrompt.length >= 2 && spread >= spreadThreshold,
  };
}

/** Splits observations by skill, for per-skill curves. */
export function groupBySkill(
  observations: readonly CalibrationObservation[]
): Map<string, CalibrationObservation[]> {
  const out = new Map<string, CalibrationObservation[]>();
  for (const o of observations) {
    const existing = out.get(o.skillId);
    if (existing) existing.push(o);
    else out.set(o.skillId, [o]);
  }
  return out;
}
