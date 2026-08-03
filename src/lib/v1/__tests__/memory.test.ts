import { describe, it, expect } from "vitest";
import {
  retrievability,
  daysUntilRetrievability,
  updateStability,
  updateDifficulty,
  applyReview,
  masteryFromStability,
  HALF_MASTERY_DAYS,
  PRIORS,
  type MemoryState,
} from "../memory";
import { GRADES } from "../grade";

const fresh = (stability: number | null, difficulty = 5): MemoryState => ({
  stability,
  difficulty,
});

describe("retrievability — operational S", () => {
  it("puts R = 0.9 at exactly Δt = S, which is what §2 defines S to mean", () => {
    // This is the whole point of resolving the spec's unit contradiction in favour
    // of §2: if this assertion fails, stored S no longer means what it claims and
    // v2 cannot swap the decay form without a migration.
    for (const s of [0.5, 3, 30, 365]) {
      expect(retrievability(s, s)).toBeCloseTo(0.9, 10);
    }
  });

  it("returns 1 at Δt = 0 and decays monotonically", () => {
    expect(retrievability(0, 10)).toBe(1);
    let prev = 1;
    for (let t = 1; t <= 100; t++) {
      const r = retrievability(t, 10);
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });

  it("returns 0 for a never-reviewed skill, not 1", () => {
    // No trace to retrieve is a different state from a fully-decayed trace, and
    // conflating them would make new skills look maximally fresh.
    expect(retrievability(0, null)).toBe(0);
    expect(retrievability(50, null)).toBe(0);
  });

  it("never leaves [0,1]", () => {
    for (const t of [0, 0.1, 1, 1e4, 1e9]) {
      for (const s of [0.05, 1, 3650]) {
        const r = retrievability(t, s);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("daysUntilRetrievability", () => {
  it("inverts retrievability", () => {
    for (const s of [1, 7, 90]) {
      for (const target of [0.9, 0.8, 0.5, 0.35]) {
        const days = daysUntilRetrievability(target, s)!;
        expect(retrievability(days, s)).toBeCloseTo(target, 10);
      }
    }
  });

  it("returns S itself for the 0.9 target", () => {
    expect(daysUntilRetrievability(0.9, 42)).toBeCloseTo(42, 10);
  });

  it("returns null where the question is undefined", () => {
    expect(daysUntilRetrievability(0.9, null)).toBeNull();
    expect(daysUntilRetrievability(0, 10)).toBeNull();
    expect(daysUntilRetrievability(1, 10)).toBeNull();
  });
});

describe("updateStability — the spacing effect", () => {
  it("gains MORE from a successful retrieval at low R than at high R", () => {
    // The load-bearing property of §3. Retrieving something you were about to
    // forget teaches more than retrieving something you already had. If this
    // inverts, the §4 urgency function is optimising for the wrong thing.
    const state = fresh(10);
    const earlyReview = updateStability(state, 0.95, "good");
    const lateReview = updateStability(state, 0.4, "good");
    expect(lateReview).toBeGreaterThan(earlyReview);
  });

  it("barely moves stability for a review made far too early", () => {
    const state = fresh(10);
    const next = updateStability(state, 0.99, "good");
    expect(next / 10).toBeLessThan(1.05);
  });

  it("is monotonically decreasing in R across the whole range", () => {
    const state = fresh(20);
    let prev = Infinity;
    for (let r = 0.05; r <= 0.99; r += 0.05) {
      const s = updateStability(state, r, "good");
      expect(s).toBeLessThan(prev);
      prev = s;
    }
  });

  it("collapses toward a relearning value on a lapse, not to zero or to new", () => {
    const state = fresh(100);
    const next = updateStability(state, 0.3, "again");
    expect(next).toBeLessThan(100);
    // Not zero, and not the cold-start prior: relearning a known item is faster.
    expect(next).toBeGreaterThan(PRIORS.initialStability.again);
    expect(next).toBeCloseTo(100 * PRIORS.lapseRetention * (1.3 - 0.06 * 4), 6);
  });

  it("loses more through a lapse when the item is harder", () => {
    const easy = updateStability(fresh(100, 1), 0.3, "again");
    const hard = updateStability(fresh(100, 10), 0.3, "again");
    expect(hard).toBeLessThan(easy);
  });

  it("grows less for hard successes than good, and more for easy", () => {
    const state = fresh(10);
    const h = updateStability(state, 0.5, "hard");
    const g = updateStability(state, 0.5, "good");
    const e = updateStability(state, 0.5, "easy");
    expect(h).toBeLessThan(g);
    expect(g).toBeLessThan(e);
    // `hard` is still a success — it must not shrink stability.
    expect(h).toBeGreaterThanOrEqual(10);
  });

  it("consolidates hard items more slowly than easy ones", () => {
    const easyItem = updateStability(fresh(10, 1), 0.5, "good");
    const hardItem = updateStability(fresh(10, 10), 0.5, "good");
    expect(hardItem).toBeLessThan(easyItem);
  });

  it("uses the priors on a first review", () => {
    for (const g of GRADES) {
      expect(updateStability(fresh(null), 0, g)).toBeCloseTo(
        PRIORS.initialStability[g],
        10
      );
    }
  });

  it("stays inside the stability bounds under adversarial input", () => {
    // One lucky retrieval must not launch an item years into the future.
    let s = 1;
    for (let i = 0; i < 200; i++) {
      s = updateStability(fresh(s, 1), 0.01, "easy");
      expect(s).toBeLessThanOrEqual(PRIORS.maxStability);
    }
    let t = 1000;
    for (let i = 0; i < 200; i++) {
      t = updateStability(fresh(t, 10), 0.01, "again");
      expect(t).toBeGreaterThanOrEqual(PRIORS.minStability);
    }
  });
});

describe("updateDifficulty", () => {
  it("moves toward harder on failure and easier on easy", () => {
    const state = fresh(10, 5);
    expect(updateDifficulty(state, "again")).toBeGreaterThan(5);
    expect(updateDifficulty(state, "hard")).toBeGreaterThan(5);
    expect(updateDifficulty(state, "easy")).toBeLessThan(5);
  });

  it("reverts toward centre so one bad session does not brand an item forever", () => {
    // Drive difficulty to the ceiling, then feed it good reviews. Without the
    // reversion term it would ratchet and stick.
    let d = 10;
    for (let i = 0; i < 40; i++) d = updateDifficulty(fresh(10, d), "good");
    expect(d).toBeLessThan(6);
    // Convergence is geometric toward the centre, not immediate.
    for (let i = 0; i < 100; i++) d = updateDifficulty(fresh(10, d), "good");
    expect(d).toBeCloseTo(PRIORS.initialDifficulty.good, 3);
  });

  it("stays within [1,10] under sustained pressure in either direction", () => {
    let d = 5;
    for (let i = 0; i < 500; i++) {
      d = updateDifficulty(fresh(10, d), "again");
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(10);
    }
    for (let i = 0; i < 500; i++) {
      d = updateDifficulty(fresh(10, d), "easy");
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(10);
    }
  });
});

describe("applyReview", () => {
  it("reports the R that was used for the update, for the event log", () => {
    // r_pred paired with the outcome is what makes calibration possible; a log of
    // outcomes alone cannot be replayed.
    const { rPred } = applyReview(fresh(10), 10, "good");
    expect(rPred).toBeCloseTo(0.9, 10);
  });

  it("computes both updates from the same pre-review state", () => {
    const state = fresh(10, 5);
    const { next } = applyReview(state, 5, "again");
    expect(next.difficulty).toBeCloseTo(updateDifficulty(state, "again"), 10);
    expect(next.stability).toBeCloseTo(
      updateStability(state, retrievability(5, 10), "again"),
      10
    );
  });

  it("produces a sane trajectory over a realistic history", () => {
    // Review each time R has decayed to ~0.9; stability should grow steadily and
    // land somewhere defensible rather than exploding or stalling.
    let state = fresh(null);
    let elapsed = 0;
    for (let i = 0; i < 10; i++) {
      const { next } = applyReview(state, elapsed, "good");
      state = next;
      elapsed = state.stability!;
    }
    expect(state.stability!).toBeGreaterThan(5);
    expect(state.stability!).toBeLessThan(PRIORS.maxStability);
  });
});

describe("masteryFromStability", () => {
  it("is 0 for never-reviewed and rises strictly, with no ceiling", () => {
    expect(masteryFromStability(null)).toBe(0);
    expect(masteryFromStability(0)).toBe(0);
    let prev = 0;
    for (const s of [0.5, 1, 7, 30, 180, 365, 3650, 36500]) {
      const m = masteryFromStability(s);
      // Strict: an item held a year and one held a decade must not be identical
      // inputs to the prerequisite gate.
      expect(m).toBeGreaterThan(prev);
      expect(m).toBeLessThan(1);
      prev = m;
    }
  });

  it("reads 0.5 at the half-mastery point and ~0.9 after a year", () => {
    expect(masteryFromStability(HALF_MASTERY_DAYS)).toBeCloseTo(0.5, 10);
    expect(masteryFromStability(365)).toBeGreaterThan(0.89);
  });

  it("is absolute, not relative to the user's other skills", () => {
    // A learner whose skills are uniformly weak must not have the least-weak one
    // read as mastered — prerequisite gating would then unlock material nobody is
    // ready for.
    expect(masteryFromStability(1)).toBeLessThan(0.1);
  });
});
