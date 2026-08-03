import { describe, it, expect } from "vitest";
import {
  calibrationCurve,
  reliableBins,
  poolHeterogeneity,
  wasSuccessful,
  groupBySkill,
  type CalibrationObservation,
} from "../calibration";
import type { Grade } from "../grade";

let seq = 0;
function obs(
  rPred: number,
  grade: Grade,
  over: Partial<CalibrationObservation> = {}
): CalibrationObservation {
  return {
    skillId: "s1",
    promptRef: `cue-${seq++}`,
    rPred,
    grade,
    ts: new Date("2026-08-03T00:00:00Z"),
    schedulerVersion: "v1",
    ...over,
  };
}

/** n observations at predicted R, of which `successes` came back. */
function band(rPred: number, n: number, successes: number, over = {}) {
  return Array.from({ length: n }, (_, i) =>
    obs(rPred, i < successes ? "good" : "again", over)
  );
}

describe("wasSuccessful", () => {
  it("counts everything but a lapse as a success", () => {
    // Same binarisation §8 uses for v2's HLR training, so a curve computed now and
    // a model trained later measure the same event.
    expect(wasSuccessful("again")).toBe(false);
    expect(wasSuccessful("hard")).toBe(true);
    expect(wasSuccessful("good")).toBe(true);
    expect(wasSuccessful("easy")).toBe(true);
  });
});

describe("calibrationCurve", () => {
  it("reports near-zero error for a perfectly calibrated model", () => {
    const observations = [
      ...band(0.25, 100, 25),
      ...band(0.55, 100, 55),
      ...band(0.85, 100, 85),
    ];
    const curve = calibrationCurve(observations);
    expect(curve.count).toBe(300);
    expect(curve.ece).toBeLessThan(0.01);
    expect(Math.abs(curve.bias)).toBeLessThan(0.01);
  });

  it("detects overconfidence with a negative bias", () => {
    // Predicted 90%, only 50% came back.
    const curve = calibrationCurve(band(0.9, 100, 50));
    expect(curve.ece).toBeCloseTo(0.4, 2);
    expect(curve.bias).toBeLessThan(-0.35);
  });

  it("detects pessimism with a positive bias", () => {
    const curve = calibrationCurve(band(0.3, 100, 80));
    expect(curve.ece).toBeCloseTo(0.5, 2);
    expect(curve.bias).toBeGreaterThan(0.45);
  });

  it("distinguishes bias from error — ECE alone cannot", () => {
    // Two bins wrong by the same amount in opposite directions: ECE is large,
    // bias cancels. Reporting only ECE would hide that the fix differs per bin.
    const curve = calibrationCurve([
      ...band(0.25, 100, 55), // pessimistic by .30
      ...band(0.85, 100, 55), // overconfident by .30
    ]);
    expect(curve.ece).toBeCloseTo(0.3, 2);
    expect(Math.abs(curve.bias)).toBeLessThan(0.01);
  });

  it("excludes pre-measurement rows by default", () => {
    // Those grades were made against no recorded cue; treating them as item
    // responses would contaminate exactly what is being measured.
    const observations = [
      ...band(0.5, 10, 5),
      ...band(0.5, 90, 90, { schedulerVersion: "sm2" }),
    ];
    expect(calibrationCurve(observations).count).toBe(10);
    expect(calibrationCurve(observations, { includePreMeasurement: true }).count).toBe(100);
  });

  it("bins by predicted R and skips empty bins", () => {
    const curve = calibrationCurve([...band(0.05, 10, 1), ...band(0.95, 10, 9)]);
    expect(curve.bins).toHaveLength(2);
    expect(curve.bins[0].lower).toBeCloseTo(0, 10);
    expect(curve.bins[1].upper).toBeCloseTo(1, 10);
  });

  it("puts R = 1.0 in the top bin rather than overflowing", () => {
    const curve = calibrationCurve(band(1.0, 10, 10));
    expect(curve.bins).toHaveLength(1);
    expect(curve.bins[0].upper).toBeCloseTo(1, 10);
  });

  it("handles an empty set without dividing by zero", () => {
    const curve = calibrationCurve([]);
    expect(curve).toMatchObject({ count: 0, ece: 0, bias: 0, bins: [] });
  });

  it("ignores non-finite predictions rather than poisoning a bin", () => {
    const curve = calibrationCurve([...band(0.5, 10, 5), obs(NaN, "good")]);
    expect(curve.count).toBe(10);
  });

  it("weights bins by their observation count", () => {
    // A badly-wrong bin with 2 observations shouldn't outweigh a correct one
    // with 200.
    const curve = calibrationCurve([...band(0.5, 200, 100), ...band(0.9, 2, 0)]);
    expect(curve.ece).toBeLessThan(0.02);
  });
});

describe("reliableBins", () => {
  it("drops bins too sparse to mean anything", () => {
    const curve = calibrationCurve([...band(0.25, 40, 10), ...band(0.85, 2, 1)]);
    expect(curve.bins).toHaveLength(2);
    expect(reliableBins(curve, 5)).toHaveLength(1);
  });
});

describe("poolHeterogeneity — the §3 mis-scoping detector", () => {
  it("flags a pool whose cues behave very differently", () => {
    // The concrete form of the skill-vs-item caveat: if one cue reliably fails
    // where its siblings succeed, the skill is a bag of heterogeneous items
    // wearing one forgetting curve.
    const observations = [
      ...band(0.7, 10, 10, { promptRef: "easy-cue" }),
      ...band(0.7, 10, 1, { promptRef: "hard-cue" }),
    ];
    const result = poolHeterogeneity("s1", observations);
    expect(result.misScoped).toBe(true);
    expect(result.spread).toBeCloseTo(0.9, 6);
    expect(result.perPrompt[0].promptRef).toBe("hard-cue");
  });

  it("does not flag a homogeneous pool", () => {
    const observations = [
      ...band(0.7, 10, 7, { promptRef: "a" }),
      ...band(0.7, 10, 7, { promptRef: "b" }),
      ...band(0.7, 10, 8, { promptRef: "c" }),
    ];
    expect(poolHeterogeneity("s1", observations).misScoped).toBe(false);
  });

  it("needs at least two cues before claiming a spread", () => {
    // One cue is a skill with nothing to compare against, not a homogeneous pool.
    const result = poolHeterogeneity("s1", band(0.7, 20, 5, { promptRef: "only" }));
    expect(result.spread).toBe(0);
    expect(result.misScoped).toBe(false);
  });

  it("ignores cues with too little data to judge", () => {
    const observations = [
      ...band(0.7, 20, 14, { promptRef: "established" }),
      ...band(0.7, 2, 0, { promptRef: "brand-new" }),
    ];
    const result = poolHeterogeneity("s1", observations, { minPromptCount: 5 });
    expect(result.perPrompt.map((p) => p.promptRef)).toEqual(["established"]);
    expect(result.misScoped).toBe(false);
  });

  it("only considers the requested skill", () => {
    const observations = [
      ...band(0.7, 10, 10, { skillId: "s1", promptRef: "a" }),
      ...band(0.7, 10, 0, { skillId: "s2", promptRef: "b" }),
    ];
    expect(poolHeterogeneity("s1", observations).perPrompt).toHaveLength(1);
  });

  it("excludes pre-measurement rows", () => {
    const observations = [
      ...band(0.7, 10, 10, { promptRef: "real" }),
      ...band(0.7, 10, 0, { promptRef: "placeholder", schedulerVersion: "sm2" }),
    ];
    expect(poolHeterogeneity("s1", observations).misScoped).toBe(false);
  });
});

describe("groupBySkill", () => {
  it("partitions observations by skill", () => {
    const grouped = groupBySkill([
      ...band(0.5, 3, 2, { skillId: "a" }),
      ...band(0.5, 2, 1, { skillId: "b" }),
    ]);
    expect(grouped.get("a")).toHaveLength(3);
    expect(grouped.get("b")).toHaveLength(2);
  });
});
