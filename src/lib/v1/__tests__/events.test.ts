import { describe, it, expect } from "vitest";
import { computeErrorDrift } from "../events";
import { gradeFromLegacyQuality, gradeRank, isLapse, GRADES } from "../grade";

describe("computeErrorDrift", () => {
  it("returns null below four attempts", () => {
    // Split halves of one or two samples carry no information; emitting a number
    // there would put noise into a parameter fit.
    expect(computeErrorDrift([])).toBeNull();
    expect(computeErrorDrift([10, 12, 14])).toBeNull();
  });

  it("is ~0 for a flat latency series", () => {
    expect(computeErrorDrift([10, 10, 10, 10, 10, 10])).toBeCloseTo(0, 6);
  });

  it("is positive when the learner slows over the block", () => {
    // The signature the leaky-integrator fatigue model predicts.
    const drift = computeErrorDrift([10, 10, 10, 20, 20, 20]);
    expect(drift).toBeCloseTo(1.0, 6);
  });

  it("is negative when the learner speeds up (warm-up, not fatigue)", () => {
    const drift = computeErrorDrift([20, 20, 20, 10, 10, 10]);
    expect(drift).toBeCloseTo(-0.5, 6);
  });

  it("resists a single interrupted attempt", () => {
    // Someone put the guitar down to answer the door. A mean-based statistic
    // would report severe fatigue from this; the median should barely move.
    const withOutlier = computeErrorDrift([10, 10, 10, 10, 10, 600])!;
    expect(Math.abs(withOutlier)).toBeLessThan(0.1);
  });

  it("returns null rather than dividing by zero on a degenerate series", () => {
    expect(computeErrorDrift([0, 0, 5, 5])).toBeNull();
  });
});

describe("grade scale", () => {
  it("has exactly four forced options", () => {
    // Four, not a slider: §3 removes the middle ground the optimistic rater
    // drifts toward.
    expect(GRADES).toHaveLength(4);
  });

  it("treats only `again` as a lapse", () => {
    expect(isLapse("again")).toBe(true);
    expect(isLapse("hard")).toBe(false);
    expect(isLapse("good")).toBe(false);
    expect(isLapse("easy")).toBe(false);
  });

  it("ranks grades in ascending success order", () => {
    expect(GRADES.map(gradeRank)).toEqual([1, 2, 3, 4]);
  });
});

describe("gradeFromLegacyQuality", () => {
  it("puts the failure boundary where SM-2 put it", () => {
    // SM-2 resets repetitions at quality < 3, so 0–2 are the failures.
    expect(gradeFromLegacyQuality(0)).toBe("again");
    expect(gradeFromLegacyQuality(1)).toBe("again");
    expect(gradeFromLegacyQuality(2)).toBe("again");
    expect(gradeFromLegacyQuality(3)).toBe("hard");
    expect(gradeFromLegacyQuality(4)).toBe("good");
    expect(gradeFromLegacyQuality(5)).toBe("easy");
  });

  it("rejects out-of-range and non-integer input", () => {
    expect(() => gradeFromLegacyQuality(-1)).toThrow();
    expect(() => gradeFromLegacyQuality(6)).toThrow();
    expect(() => gradeFromLegacyQuality(3.5)).toThrow();
  });
});
