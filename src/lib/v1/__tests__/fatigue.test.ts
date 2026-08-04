import { describe, it, expect } from "vitest";
import {
  chargeAfterSession,
  decayAfterIdle,
  fatiguePenalty,
  currentSaturation,
  normaliseLoading,
  CHANNELS,
  ZERO_SATURATION,
  UNIFORM_LOADING,
  type FatigueConstants,
} from "../fatigue";

const K: FatigueConstants = {
  tauMinutes: [50, 50, 50, 50],
  rhoMinutes: [75, 75, 75, 75],
};

// Indices in CHANNELS order: logical, verbal, visual, motor.
const LOGICAL_ONLY = [1, 0, 0, 0];
const MOTOR_ONLY = [0, 0, 0, 1];

describe("chargeAfterSession", () => {
  it("rises monotonically with block length and saturates below 1", () => {
    let prev = 0;
    for (const d of [1, 5, 15, 30, 60, 120, 480, 10000]) {
      const sat = chargeAfterSession(ZERO_SATURATION, LOGICAL_ONLY, d, K)[0];
      expect(sat).toBeGreaterThan(prev);
      expect(sat).toBeLessThanOrEqual(1);
      prev = sat;
    }
    // Bounded however long the block runs — this is what keeps F_i comparable and
    // the utility ordering stable.
    expect(prev).toBeLessThanOrEqual(1);
  });

  it("leaves channels the skill does not load untouched", () => {
    const sat = chargeAfterSession([0.4, 0.4, 0.4, 0.4], LOGICAL_ONLY, 60, K);
    expect(sat[0]).toBeGreaterThan(0.4);
    expect(sat[1]).toBeCloseTo(0.4, 12);
    expect(sat[2]).toBeCloseTo(0.4, 12);
    expect(sat[3]).toBeCloseTo(0.4, 12);
  });

  it("reaches 1 - 1/e of the way to full at exactly tau under full load", () => {
    // The interpretable meaning of tau: "time-to-fatigue under full load".
    const sat = chargeAfterSession(ZERO_SATURATION, LOGICAL_ONLY, 50, K)[0];
    expect(sat).toBeCloseTo(1 - Math.exp(-1), 10);
  });

  it("charges proportionally slower under partial load", () => {
    const full = chargeAfterSession(ZERO_SATURATION, [1, 0, 0, 0], 30, K)[0];
    const half = chargeAfterSession(ZERO_SATURATION, [0.5, 0, 0, 0], 30, K)[0];
    expect(half).toBeLessThan(full);
    // Half load for 30 min == full load for 15 min.
    const fullHalfTime = chargeAfterSession(ZERO_SATURATION, [1, 0, 0, 0], 15, K)[0];
    expect(half).toBeCloseTo(fullHalfTime, 12);
  });

  it("is composable: two blocks equal one of the summed length", () => {
    // Required for the emergent-session loop, which recharges after every attempt
    // rather than once at the end. If this failed, fatigue would depend on how
    // often the controller happened to sample.
    const once = chargeAfterSession(ZERO_SATURATION, LOGICAL_ONLY, 40, K);
    const first = chargeAfterSession(ZERO_SATURATION, LOGICAL_ONLY, 15, K);
    const twice = chargeAfterSession(first, LOGICAL_ONLY, 25, K);
    expect(twice[0]).toBeCloseTo(once[0], 12);
  });

  it("is a no-op for a zero or negative duration", () => {
    const s: number[] = [0.3, 0.2, 0.1, 0.0];
    expect(chargeAfterSession(s, LOGICAL_ONLY, 0, K)).toEqual(s);
    expect(chargeAfterSession(s, LOGICAL_ONLY, -5, K)).toEqual(s);
  });
});

describe("decayAfterIdle", () => {
  it("falls monotonically toward zero", () => {
    let prev = 1;
    for (const idle of [1, 10, 30, 75, 200, 1440]) {
      const sat = decayAfterIdle([1, 1, 1, 1], idle, K)[0];
      expect(sat).toBeLessThan(prev);
      expect(sat).toBeGreaterThanOrEqual(0);
      prev = sat;
    }
  });

  it("decays to 1/e of its value at exactly rho", () => {
    expect(decayAfterIdle([1, 1, 1, 1], 75, K)[0]).toBeCloseTo(Math.exp(-1), 10);
  });

  it("is composable across split intervals", () => {
    const once = decayAfterIdle([0.8, 0, 0, 0], 60, K)[0];
    const twice = decayAfterIdle(decayAfterIdle([0.8, 0, 0, 0], 25, K), 35, K)[0];
    expect(twice).toBeCloseTo(once, 12);
  });

  it("effectively clears overnight", () => {
    // A returning learner must not carry yesterday's saturation, which would
    // suppress exactly the skills they are freshest for.
    expect(decayAfterIdle([1, 1, 1, 1], 8 * 60, K)[0]).toBeLessThan(0.01);
  });

  it("inverts charging: charge then idle a long time returns to rest", () => {
    const charged = chargeAfterSession(ZERO_SATURATION, UNIFORM_LOADING, 90, K);
    const rested = decayAfterIdle(charged, 10000, K);
    for (const s of rested) expect(s).toBeCloseTo(0, 6);
  });
});

describe("fatiguePenalty", () => {
  it("is zero at rest regardless of loading", () => {
    expect(fatiguePenalty(UNIFORM_LOADING, ZERO_SATURATION)).toBe(0);
    expect(fatiguePenalty(LOGICAL_ONLY, ZERO_SATURATION)).toBe(0);
  });

  it("charges a skill only for the channels it actually loads", () => {
    // The mechanism the whole cross-domain claim rests on: after heavy logical
    // work, a motor skill should be nearly free while another logical one is not.
    const afterDebugging = chargeAfterSession(ZERO_SATURATION, LOGICAL_ONLY, 120, K);
    const anotherLogicalSkill = fatiguePenalty(LOGICAL_ONLY, afterDebugging);
    const aGuitarSkill = fatiguePenalty(MOTOR_ONLY, afterDebugging);
    expect(aGuitarSkill).toBe(0);
    expect(anotherLogicalSkill).toBeGreaterThan(0.8);
  });

  it("puts concentrated and spread loadings on the same scale", () => {
    // beta is a single global weight in §7; if these diverged it would mean
    // different things for different skills.
    const fullySaturated = [1, 1, 1, 1];
    expect(fatiguePenalty([1, 0, 0, 0], fullySaturated)).toBeCloseTo(1, 12);
    expect(fatiguePenalty(UNIFORM_LOADING, fullySaturated)).toBeCloseTo(1, 12);
  });

  it("stays in [0,1] for normalised loadings", () => {
    for (const sat of [ZERO_SATURATION, [0.5, 0.2, 0.9, 0.1], [1, 1, 1, 1]]) {
      const f = fatiguePenalty(UNIFORM_LOADING, sat);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });
});

describe("currentSaturation", () => {
  it("applies idle decay from the persisted timestamp", () => {
    const persistedAt = new Date("2026-08-03T09:00:00Z");
    const now = new Date("2026-08-03T10:15:00Z"); // 75 min = one rho
    const sat = currentSaturation([1, 1, 1, 1], persistedAt, now, K);
    expect(sat[0]).toBeCloseTo(Math.exp(-1), 10);
  });

  it("does not resurrect saturation when now precedes the timestamp", () => {
    const t = new Date("2026-08-03T10:00:00Z");
    const earlier = new Date("2026-08-03T09:00:00Z");
    expect(currentSaturation([0.5, 0.5, 0.5, 0.5], t, earlier, K)).toEqual([
      0.5, 0.5, 0.5, 0.5,
    ]);
  });
});

describe("normaliseLoading", () => {
  it("projects onto the simplex", () => {
    const n = normaliseLoading([2, 1, 1, 0]);
    expect(n.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(n[0]).toBeCloseTo(0.5, 12);
  });

  it("makes two differently-scaled proposals for the same skill identical", () => {
    // Otherwise a model that happens to emit larger numbers makes a skill
    // permanently more expensive than an identical one described differently —
    // a scheduling difference caused by prose style rather than cognition.
    expect(normaliseLoading([8, 4, 4, 0])).toEqual(normaliseLoading([2, 1, 1, 0]));
  });

  it("falls back to uniform rather than creating a fatigue-immune skill", () => {
    // An all-zero loading would make F_i identically 0, and the skill would
    // dominate the argmax indefinitely once everything else fatigued.
    expect(normaliseLoading([0, 0, 0, 0])).toEqual([...UNIFORM_LOADING]);
    expect(normaliseLoading([-1, -2, 0, 0])).toEqual([...UNIFORM_LOADING]);
    expect(normaliseLoading([NaN, NaN, NaN, NaN])).toEqual([...UNIFORM_LOADING]);
  });

  it("falls back to uniform on a wrong-length proposal", () => {
    expect(normaliseLoading([1, 1])).toEqual([...UNIFORM_LOADING]);
    expect(normaliseLoading([1, 1, 1, 1, 1])).toEqual([...UNIFORM_LOADING]);
  });
});

describe("shape validation", () => {
  it("rejects vectors that do not match the channel count", () => {
    // A silent length mismatch would make the dot product read garbage.
    expect(() => fatiguePenalty([1, 0], ZERO_SATURATION)).toThrow();
    expect(() => chargeAfterSession([0, 0], LOGICAL_ONLY, 10, K)).toThrow();
    expect(() => decayAfterIdle([0, 0, 0], 10, K)).toThrow();
  });

  it("keeps the channel order fixed", () => {
    expect(CHANNELS).toEqual(["logical", "verbal", "visual", "motor"]);
  });
});
