import { describe, it, expect } from "vitest";
import { rankSkills, computeRetrievability, formatReasonText } from "../scheduler";

const NOW = new Date("2025-01-15T12:00:00Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

describe("computeRetrievability", () => {
  it("returns 1.0 at t=0", () => {
    expect(computeRetrievability(0, 10)).toBeCloseTo(1.0);
  });

  it("returns ~0.37 when daysSince equals stability", () => {
    expect(computeRetrievability(10, 10)).toBeCloseTo(Math.exp(-1), 2);
  });

  it("returns 0 when stability is 0", () => {
    expect(computeRetrievability(5, 0)).toBe(0);
  });
});

describe("rankSkills", () => {
  it("new skills (no lastReviewedAt) get highest priority", () => {
    const result = rankSkills(
      [
        { skillId: "a", skillName: "Guitar", intervalDays: 6, lastReviewedAt: daysAgo(1), defaultSessionMinutes: 25 },
        { skillId: "b", skillName: "Spanish", intervalDays: 0, lastReviewedAt: null, defaultSessionMinutes: 30 },
      ],
      NOW
    );
    expect(result[0].skillId).toBe("b");
    expect(result[0].isNew).toBe(true);
  });

  it("overdue skills rank above non-due skills", () => {
    const result = rankSkills(
      [
        { skillId: "a", skillName: "Guitar", intervalDays: 10, lastReviewedAt: daysAgo(1), defaultSessionMinutes: 25 },
        { skillId: "b", skillName: "Spanish", intervalDays: 3, lastReviewedAt: daysAgo(10), defaultSessionMinutes: 30 },
      ],
      NOW
    );
    expect(result[0].skillId).toBe("b");
    expect(result[0].priorityScore).toBeGreaterThan(0);
  });

  it("recently reviewed skills have priority 0", () => {
    const result = rankSkills(
      [
        { skillId: "a", skillName: "Guitar", intervalDays: 30, lastReviewedAt: daysAgo(1), defaultSessionMinutes: 25 },
      ],
      NOW
    );
    expect(result[0].priorityScore).toBe(0);
  });
});

describe("formatReasonText", () => {
  it("describes new skills appropriately", () => {
    const text = formatReasonText({
      skillId: "a", skillName: "Guitar", retrievability: 0,
      daysSinceReview: null, intervalDays: 0, priorityScore: Infinity,
      sessionMinutes: 25, isNew: true,
    });
    expect(text).toContain("new");
    expect(text).toContain("Guitar");
  });

  it("describes due skills with retrievability percentage", () => {
    const text = formatReasonText({
      skillId: "a", skillName: "Spanish", retrievability: 0.72,
      daysSinceReview: 5, intervalDays: 3, priorityScore: 0.13,
      sessionMinutes: 30, isNew: false,
    });
    expect(text).toContain("72%");
    expect(text).toContain("desirable difficulty");
  });
});
