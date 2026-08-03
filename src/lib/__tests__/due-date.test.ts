import { describe, it, expect } from "vitest";
import { daysUntilDue, computeRetrievability, R_THRESHOLD } from "../scheduler";
import type { SchedulerRecommendation } from "../scheduler";
import { retrievability } from "../v1/memory";

function rec(over: Partial<SchedulerRecommendation> = {}): SchedulerRecommendation {
  return {
    skillId: "s",
    skillName: "Skill",
    retrievability: 0.9,
    daysSinceReview: 0,
    intervalDays: 30,
    priorityScore: 0,
    sessionMinutes: 25,
    isNew: false,
    ...over,
  };
}

describe("daysUntilDue — one definition, one answer", () => {
  it("agrees with the decay model it claims to describe", () => {
    // The property the two old inline formulas could not both satisfy: at the
    // moment daysUntilDue reports 0, retrievability is actually at the threshold.
    for (const intervalDays of [1, 7, 30, 365]) {
      const daysToThreshold = daysUntilDue(rec({ intervalDays, daysSinceReview: 0 }));
      expect(retrievability(daysToThreshold, intervalDays)).toBeCloseTo(R_THRESHOLD, 10);
    }
  });

  it("goes negative once a skill is overdue", () => {
    const overdue = rec({ intervalDays: 30, daysSinceReview: 100 });
    expect(daysUntilDue(overdue)).toBeLessThan(0);
  });

  it("counts down as time passes", () => {
    let prev = Infinity;
    for (const daysSinceReview of [0, 5, 10, 20, 40]) {
      const d = daysUntilDue(rec({ intervalDays: 30, daysSinceReview }));
      expect(d).toBeLessThan(prev);
      prev = d;
    }
  });

  it("rejects the formula the sidebar used to use", () => {
    // Regression guard for the actual defect. The sidebar computed
    // `intervalDays - daysSinceReview`, answering "when does R hit 1/e" rather
    // than "when does R hit the review threshold" — a different question with a
    // very different answer, displayed next to the correct one.
    const r = rec({ intervalDays: 30, daysSinceReview: 5 });
    const oldSidebarFormula = r.intervalDays - (r.daysSinceReview ?? 0);
    expect(oldSidebarFormula).toBe(25);

    // The honest answer: with S = 30 (days to R = 0.9), R reaches 0.85 at ~46
    // days, so ~41 remain. The sidebar was off by more than two weeks, and the
    // comeback banner beside it showed a third number again.
    const correct = daysUntilDue(r);
    expect(retrievability(correct + 5, 30)).toBeCloseTo(R_THRESHOLD, 10);
    expect(Math.abs(correct - oldSidebarFormula)).toBeGreaterThan(15);
  });

  it("treats a new skill as due now", () => {
    expect(daysUntilDue(rec({ isNew: true }))).toBe(0);
  });

  it("does not divide by zero on a zero interval", () => {
    expect(Number.isFinite(daysUntilDue(rec({ intervalDays: 0 })))).toBe(true);
  });
});

describe("computeRetrievability — operational stability units", () => {
  it("reads intervalDays as days-until-R-hits-0.9, matching what sessions write", () => {
    // Before this fix the dashboard interpreted the same stored number as the raw
    // exponential scale, placing R = 0.9 at 0.105*S and under-reporting recall for
    // every skill on screen.
    expect(computeRetrievability(30, 30)).toBeCloseTo(0.9, 10);
    expect(computeRetrievability(0, 30)).toBe(1);
  });

  it("returns 0 for a zero or negative stability", () => {
    expect(computeRetrievability(5, 0)).toBe(0);
    expect(computeRetrievability(5, -1)).toBe(0);
  });
});
