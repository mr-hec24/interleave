import { describe, it, expect } from "vitest";
import {
  reachable,
  softReadiness,
  unmetPrereqs,
  findCycle,
  assertAcyclic,
  wouldCreateCycle,
  PREREQ_MET_THRESHOLD,
  type PrereqEdge,
} from "../readiness";
import { masteryFromStability, HALF_MASTERY_DAYS } from "../memory";

const edge = (skillId: string, prereqSkillId: string): PrereqEdge => ({
  skillId,
  prereqSkillId,
});

/** Stability that lands comfortably above / below the prereq threshold. */
const MASTERED = 200;
const WEAK = 1;

function stabilities(entries: Record<string, number | null>) {
  return new Map(Object.entries(entries));
}

describe("reachable — the hard mask", () => {
  it("admits a skill with no prerequisites", () => {
    expect(reachable("a", [], stabilities({}))).toBe(true);
  });

  it("blocks a skill whose prerequisite is unmastered", () => {
    const edges = [edge("advanced", "basics")];
    expect(reachable("advanced", edges, stabilities({ basics: WEAK }))).toBe(false);
  });

  it("admits it once the prerequisite is mastered", () => {
    const edges = [edge("advanced", "basics")];
    expect(reachable("advanced", edges, stabilities({ basics: MASTERED }))).toBe(true);
  });

  it("treats a never-reviewed prerequisite as unmet", () => {
    const edges = [edge("advanced", "basics")];
    expect(reachable("advanced", edges, stabilities({ basics: null }))).toBe(false);
  });

  it("treats an unknown prerequisite as unmet rather than failing open", () => {
    // A dangling edge — one whose target was archived, say — must not silently
    // disable the gate.
    const edges = [edge("advanced", "ghost")];
    expect(reachable("advanced", edges, stabilities({}))).toBe(false);
  });

  it("requires ALL prerequisites, not any", () => {
    const edges = [edge("c", "a"), edge("c", "b")];
    expect(reachable("c", edges, stabilities({ a: MASTERED, b: WEAK }))).toBe(false);
    expect(reachable("c", edges, stabilities({ a: MASTERED, b: MASTERED }))).toBe(true);
  });

  it("propagates transitively without walking the graph", () => {
    // If a grandparent is unmet, the parent cannot itself have crossed the
    // threshold, so checking direct parents is sufficient.
    const edges = [edge("c", "b"), edge("b", "a")];
    const s = stabilities({ a: WEAK, b: WEAK, c: null });
    expect(reachable("b", edges, s)).toBe(false);
    expect(reachable("c", edges, s)).toBe(false);
  });

  it("gates exactly at the documented threshold", () => {
    const edges = [edge("x", "p")];
    // Stability that yields mastery just under / just over the threshold.
    const atThreshold =
      (HALF_MASTERY_DAYS * PREREQ_MET_THRESHOLD) / (1 - PREREQ_MET_THRESHOLD);
    expect(masteryFromStability(atThreshold)).toBeCloseTo(PREREQ_MET_THRESHOLD, 10);
    expect(reachable("x", edges, stabilities({ p: atThreshold * 0.99 }))).toBe(false);
    expect(reachable("x", edges, stabilities({ p: atThreshold * 1.01 }))).toBe(true);
  });
});

describe("the gating subtlety — why masked skills are removed, not zeroed", () => {
  it("a zero mask would outrank a legitimate skill with negative utility", () => {
    // This is the trap §6's "multiplicative" wording invites. U can go negative
    // when fatigue dominates; 1[false] * U = 0 > U, so the locked skill wins the
    // argmax precisely when the learner is most tired.
    const lockedUtility = 0 * -0.4; // multiplicative gating on a negative utility
    const reachableUtility = -0.4;
    expect(lockedUtility).toBeGreaterThan(reachableUtility);

    // The correct behaviour: the locked skill is not a candidate at all.
    const candidates = [
      { id: "locked", utility: -0.4, reachable: false },
      { id: "open", utility: -0.4, reachable: true },
    ].filter((c) => c.reachable);
    expect(candidates.map((c) => c.id)).toEqual(["open"]);
  });
});

describe("softReadiness", () => {
  it("is 1 for a skill with no prerequisites", () => {
    expect(softReadiness("a", [], stabilities({}))).toBe(1);
  });

  it("is bounded by the WEAKEST prerequisite, not an average", () => {
    // Many strong foundations must not paper over one missing foundation.
    const edges = [edge("c", "strong1"), edge("c", "strong2"), edge("c", "weak")];
    const s = stabilities({ strong1: 3650, strong2: 3650, weak: 0.5 });
    const readiness = softReadiness("c", edges, s);
    expect(readiness).toBeCloseTo(masteryFromStability(0.5), 12);
    expect(readiness).toBeLessThan(0.05);
  });

  it("rises as the weakest prerequisite is strengthened", () => {
    const edges = [edge("c", "p")];
    let prev = -1;
    for (const s of [1, 10, 40, 200, 1000]) {
      const r = softReadiness("c", edges, stabilities({ p: s }));
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
  });

  it("is 0 when a prerequisite has never been reviewed", () => {
    expect(softReadiness("c", [edge("c", "p")], stabilities({ p: null }))).toBe(0);
  });

  it("stays within [0,1]", () => {
    const edges = [edge("c", "a"), edge("c", "b")];
    for (const [a, b] of [
      [null, null],
      [1, 3650],
      [3650, 3650],
    ] as Array<[number | null, number | null]>) {
      const r = softReadiness("c", edges, stabilities({ a, b }));
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});

describe("unmetPrereqs", () => {
  it("names only the prerequisites actually blocking the skill", () => {
    const edges = [edge("c", "ok"), edge("c", "blocking")];
    const s = stabilities({ ok: MASTERED, blocking: WEAK });
    expect(unmetPrereqs("c", edges, s)).toEqual(["blocking"]);
  });

  it("is empty exactly when the skill is reachable", () => {
    const edges = [edge("c", "p")];
    const s = stabilities({ p: MASTERED });
    expect(unmetPrereqs("c", edges, s)).toEqual([]);
    expect(reachable("c", edges, s)).toBe(true);
  });
});

describe("findCycle", () => {
  it("accepts an empty graph and a simple chain", () => {
    expect(findCycle([]).acyclic).toBe(true);
    expect(findCycle([edge("b", "a"), edge("c", "b")]).acyclic).toBe(true);
  });

  it("accepts a diamond — shared prerequisites are not a cycle", () => {
    const edges = [edge("b", "a"), edge("c", "a"), edge("d", "b"), edge("d", "c")];
    expect(findCycle(edges).acyclic).toBe(true);
  });

  it("detects a two-node cycle", () => {
    const result = findCycle([edge("b", "a"), edge("a", "b")]);
    expect(result.acyclic).toBe(false);
    expect(result.cycle).not.toBeNull();
  });

  it("detects a longer cycle and reports the path", () => {
    const result = findCycle([edge("b", "a"), edge("c", "b"), edge("a", "c")]);
    expect(result.acyclic).toBe(false);
    // Reported path closes on itself.
    expect(result.cycle![0]).toBe(result.cycle![result.cycle!.length - 1]);
    expect(new Set(result.cycle)).toEqual(new Set(["a", "b", "c"]));
  });

  it("detects a cycle in a disconnected component", () => {
    const edges = [edge("b", "a"), edge("y", "x"), edge("x", "y")];
    expect(findCycle(edges).acyclic).toBe(false);
  });

  it("survives a long chain without blowing the stack", () => {
    // An LLM can propose a long chain; validating untrusted input must not be a
    // stack-overflow vector.
    const edges: PrereqEdge[] = [];
    for (let i = 1; i < 20000; i++) edges.push(edge(`s${i}`, `s${i - 1}`));
    expect(findCycle(edges).acyclic).toBe(true);
    edges.push(edge("s0", "s19999"));
    expect(findCycle(edges).acyclic).toBe(false);
  });

  it("does not re-report an already-finished node as a cycle", () => {
    // Regression guard for the classic colour-marking bug: a node reachable by two
    // separate paths is not a cycle.
    const edges = [edge("b", "a"), edge("c", "a"), edge("c", "b")];
    expect(findCycle(edges).acyclic).toBe(true);
  });
});

describe("assertAcyclic / wouldCreateCycle", () => {
  it("assertAcyclic throws only on a cycle", () => {
    expect(() => assertAcyclic([edge("b", "a")])).not.toThrow();
    expect(() => assertAcyclic([edge("b", "a"), edge("a", "b")])).toThrow(/cycle/i);
  });

  it("rejects a self-edge", () => {
    expect(wouldCreateCycle([], edge("a", "a"))).toBe(true);
  });

  it("predicts closure without mutating the existing graph", () => {
    const edges = [edge("b", "a"), edge("c", "b")];
    expect(wouldCreateCycle(edges, edge("a", "c"))).toBe(true);
    expect(wouldCreateCycle(edges, edge("d", "c"))).toBe(false);
    expect(edges).toHaveLength(2);
  });
});
