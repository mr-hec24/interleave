import { describe, it, expect } from "vitest";
import { urgency, bandOffset } from "../urgency";

const THETA = 0.35;
const SIGMA = 0.15;
const D = (r: number) => urgency(r, THETA, SIGMA);

describe("urgency — the saturating branch", () => {
  it("gives a badly overdue skill FULL urgency, not near-zero", () => {
    // The failure mode §4 exists to rule out. Under a symmetric Gaussian a skill
    // at R = 0.05 would score exp(-2) ≈ 0.005, lose the argmax forever, and decay
    // further — the death spiral. Anything below target must read as maximal.
    expect(D(0.05)).toBe(1);
    expect(D(0.0)).toBe(1);
    expect(D(0.2)).toBe(1);
    expect(D(THETA)).toBe(1);
  });

  it("never decreases as a skill becomes more forgotten", () => {
    // Monotone in (1 - R), per MEMORIZE. Nothing about being more forgotten
    // should make review less urgent, anywhere on the curve.
    let prev = 0;
    for (let r = 1.0; r >= 0; r -= 0.01) {
      const d = D(r);
      expect(d).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = d;
    }
  });

  it("diverges from the rejected symmetric Gaussian exactly where it matters", () => {
    // Explicit contrast with the design §4 rejects, kept as a test so the
    // distinction cannot be quietly refactored away. The defect is directional,
    // not a matter of magnitude: below target the symmetric form *falls* as the
    // skill gets more forgotten, which is the death spiral.
    const symmetric = (r: number) =>
      Math.exp(-((r - THETA) ** 2) / (2 * SIGMA * SIGMA));

    let prevSymmetric = symmetric(THETA);
    for (let r = THETA - 0.01; r >= 0; r -= 0.01) {
      expect(symmetric(r)).toBeLessThan(prevSymmetric); // spirals down
      expect(D(r)).toBe(1); // ours does not
      prevSymmetric = symmetric(r);
    }

    // At the extreme the gap is an order of magnitude: a fully-forgotten skill
    // would be scored ~15x less urgent than one sitting right at target.
    expect(symmetric(0) / symmetric(THETA)).toBeLessThan(0.07);
    expect(D(0) / D(THETA)).toBe(1);
  });
});

describe("urgency — the penalised branch", () => {
  it("peaks at the target and falls off above it", () => {
    expect(D(THETA)).toBe(1);
    expect(D(0.5)).toBeLessThan(1);
    expect(D(0.7)).toBeLessThan(D(0.5));
    expect(D(0.95)).toBeLessThan(D(0.7));
  });

  it("matches the spec's stated shape at one and two sigma", () => {
    // §4: "roughly R ≈ 0.61 at 1σ, ≈ 0.14 at 2σ" above target.
    expect(D(THETA + SIGMA)).toBeCloseTo(Math.exp(-0.5), 10);
    expect(D(THETA + SIGMA)).toBeCloseTo(0.6065, 3);
    expect(D(THETA + 2 * SIGMA)).toBeCloseTo(Math.exp(-2), 10);
    expect(D(THETA + 2 * SIGMA)).toBeCloseTo(0.1353, 3);
  });

  it("strongly deprioritises a skill reviewed far too early", () => {
    // R = 0.99 is a wasted spacing opportunity, and should score near nothing.
    expect(D(0.99)).toBeLessThan(0.01);
  });

  it("stays within (0,1] across the whole range", () => {
    for (let r = 0; r <= 1.0001; r += 0.005) {
      const d = D(r);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it("is continuous at the join", () => {
    // A discontinuity at θ would make the hysteresis comparison jumpy for reasons
    // that have nothing to do with the learner's memory.
    expect(D(THETA - 1e-9)).toBeCloseTo(D(THETA + 1e-9), 12);
  });
});

describe("urgency — parameterisation", () => {
  it("widens the tolerated band as sigma grows", () => {
    expect(urgency(0.6, THETA, 0.3)).toBeGreaterThan(urgency(0.6, THETA, 0.15));
  });

  it("shifts the peak with theta", () => {
    expect(urgency(0.6, 0.6, SIGMA)).toBe(1);
    expect(urgency(0.6, 0.35, SIGMA)).toBeLessThan(1);
  });

  it("rejects a non-positive sigma rather than dividing by zero", () => {
    expect(() => urgency(0.5, THETA, 0)).toThrow();
    expect(() => urgency(0.5, THETA, -0.1)).toThrow();
  });
});

describe("bandOffset", () => {
  it("reports distance above target in sigma units", () => {
    expect(bandOffset(THETA, THETA, SIGMA)).toBeCloseTo(0, 10);
    expect(bandOffset(THETA + SIGMA, THETA, SIGMA)).toBeCloseTo(1, 10);
    expect(bandOffset(THETA + 2 * SIGMA, THETA, SIGMA)).toBeCloseTo(2, 10);
  });

  it("goes negative below target, where urgency is saturated", () => {
    expect(bandOffset(0.05, THETA, SIGMA)).toBeLessThan(0);
  });
});
