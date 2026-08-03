import { describe, it, expect } from "vitest";
import {
  createSessionState,
  serveNextPrompt,
  recordAttempt,
  evaluateSwitch,
  finishBlock,
  moveTo,
  rank,
  type EngineDeps,
} from "../session/engine";
import { DEFAULT_CONFIG } from "../config";
import { buildSimilarityGraph } from "../similarity";
import { ZERO_SATURATION } from "../fatigue";
import type { CandidateSkill } from "../controller";
import type { RetrievalPrompt } from "../prompts";

const T0 = new Date("2026-08-03T09:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60000);

const LOGICAL = [1, 0, 0, 0];
const MOTOR = [0, 0, 0, 1];

function skill(id: string, over: Partial<CandidateSkill> = {}): CandidateSkill {
  return {
    id,
    name: id,
    stability: 10,
    difficulty: 5,
    channelLoadings: [0.25, 0.25, 0.25, 0.25],
    priorityWeight: 1,
    lastReviewedAt: new Date(T0.getTime() - 60 * 86400000),
    promptPoolSize: 3,
    ...over,
  };
}

function pool(skillId: string, n = 3): RetrievalPrompt[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${skillId}-cue${i}`,
    skillId,
    text: `cue ${i} for ${skillId}`,
    source: "user" as const,
    lastServedAt: null,
    timesServed: 0,
  }));
}

function setup(skills: CandidateSkill[], deps: Partial<EngineDeps> = {}) {
  const prompts = new Map(skills.map((s) => [s.id, pool(s.id)]));
  const state = createSessionState("sess-1", skills, [...ZERO_SATURATION], prompts, T0);
  const engineDeps: EngineDeps = {
    config: DEFAULT_CONFIG,
    prereqEdges: [],
    similarityGraph: buildSimilarityGraph([]),
    rand: () => 0.99, // suppress the cue-selection jitter
    ...deps,
  };
  return { state, deps: engineDeps };
}

describe("serveNextPrompt", () => {
  it("serves a cue from the current skill's pool", () => {
    const { state, deps } = setup([skill("a")]);
    moveTo(state, "a", T0);
    const cue = serveNextPrompt(state, deps, T0);
    expect(cue).not.toBeNull();
    expect(cue!.skillId).toBe("a");
    expect(state.promptShownAt).toEqual(T0);
  });

  it("returns null for a skill with an empty pool", () => {
    // The caller must treat this as "no longer practisable" rather than continuing
    // with no cue — an ungradeable attempt is exactly what the layer prevents.
    const { state, deps } = setup([skill("a")]);
    state.promptsBySkill.set("a", []);
    moveTo(state, "a", T0);
    expect(serveNextPrompt(state, deps, T0)).toBeNull();
  });

  it("rotates through the pool rather than repeating one cue", () => {
    const { state, deps } = setup([skill("a")]);
    moveTo(state, "a", T0);
    const served = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const cue = serveNextPrompt(state, deps, at(i))!;
      served.add(cue.id);
      recordAttempt(state, deps, "good", at(i + 0.2));
    }
    expect(served.size).toBe(3);
  });
});

describe("recordAttempt", () => {
  it("logs the prediction made from the PRE-review state", () => {
    // r_pred paired with the outcome is the whole basis of calibration; logging a
    // post-update value would make the log unusable for it.
    const { state, deps } = setup([
      skill("a", { stability: 10, lastReviewedAt: new Date(T0.getTime() - 10 * 86400000) }),
    ]);
    moveTo(state, "a", T0);
    serveNextPrompt(state, deps, T0);
    const attempt = recordAttempt(state, deps, "good", at(1));
    expect(attempt.rPred).toBeCloseTo(0.9, 3);
    expect(attempt.sBefore).toBe(10);
    expect(attempt.sAfter).not.toBe(10);
  });

  it("does not advance the skill mid-block", () => {
    // Per-attempt updating collapses urgency after one retrieval and makes every
    // block exactly one attempt long — see the module note on aggregation.
    const { state, deps } = setup([
      skill("a", { stability: 10, lastReviewedAt: new Date(T0.getTime() - 60 * 86400000) }),
    ]);
    moveTo(state, "a", T0);
    const live = state.skills[0];

    serveNextPrompt(state, deps, T0);
    recordAttempt(state, deps, "good", at(1));
    expect(live.stability).toBe(10);
    expect(live.lastReviewedAt!.getTime()).toBe(T0.getTime() - 60 * 86400000);

    serveNextPrompt(state, deps, at(1));
    const second = recordAttempt(state, deps, "good", at(2));

    // Both attempts predict essentially the same R — they differ only by the
    // minute of real decay between them, not by a state change the first attempt
    // caused. Under per-attempt updating the second would have predicted ~1.0.
    expect(second.rPred).toBeCloseTo(state.attempts[0].rPred, 4);
    expect(second.rPred).toBeLessThan(0.6);
  });

  it("measures latency from cue shown to grade submitted", () => {
    const { state, deps } = setup([skill("a")]);
    moveTo(state, "a", T0);
    serveNextPrompt(state, deps, T0);
    const attempt = recordAttempt(state, deps, "good", at(2.5));
    expect(attempt.latencySeconds).toBeCloseTo(150, 6);
  });

  it("numbers attempts per cue so first attempts are identifiable", () => {
    // §9.3's readiness head trains on first-attempt outcomes.
    const { state, deps } = setup([skill("a")]);
    state.promptsBySkill.set("a", pool("a", 1));
    moveTo(state, "a", T0);
    for (let i = 1; i <= 3; i++) {
      serveNextPrompt(state, deps, at(i));
      const attempt = recordAttempt(state, deps, "good", at(i + 0.1));
      expect(attempt.attemptIndex).toBe(i);
    }
  });

  it("accumulates fatigue on the channels the skill loads", () => {
    const { state, deps } = setup([skill("a", { channelLoadings: LOGICAL })]);
    moveTo(state, "a", T0);
    serveNextPrompt(state, deps, T0);
    recordAttempt(state, deps, "good", at(10));
    expect(state.saturation[0]).toBeGreaterThan(0);
    expect(state.saturation[3]).toBe(0);
  });

  it("charges fatigue independently of how often the controller samples", () => {
    // Composability matters here: if per-attempt charging diverged from one charge
    // over the block, measured fatigue would depend on cue granularity rather than
    // on the learner.
    const coarse = setup([skill("a", { channelLoadings: LOGICAL })]);
    moveTo(coarse.state, "a", T0);
    serveNextPrompt(coarse.state, coarse.deps, T0);
    recordAttempt(coarse.state, coarse.deps, "good", at(12));

    const fine = setup([skill("a", { channelLoadings: LOGICAL })]);
    moveTo(fine.state, "a", T0);
    for (let i = 0; i < 4; i++) {
      serveNextPrompt(fine.state, fine.deps, at(i * 3));
      recordAttempt(fine.state, fine.deps, "good", at((i + 1) * 3));
    }

    expect(fine.state.saturation[0]).toBeCloseTo(coarse.state.saturation[0], 10);
  });

  it("puts the just-practised skill at the front of the recency window", () => {
    const { state, deps } = setup([skill("a"), skill("b")]);
    moveTo(state, "a", T0);
    serveNextPrompt(state, deps, T0);
    recordAttempt(state, deps, "good", at(1));
    expect(state.recentPractice[0]).toEqual({ skillId: "a", blocksAgo: 1 });

    moveTo(state, "b", at(2));
    serveNextPrompt(state, deps, at(2));
    recordAttempt(state, deps, "good", at(3));
    expect(state.recentPractice[0]).toEqual({ skillId: "b", blocksAgo: 1 });
    expect(state.recentPractice.find((r) => r.skillId === "a")!.blocksAgo).toBe(2);
  });

  it("throws rather than recording an attempt with no cue on screen", () => {
    const { state, deps } = setup([skill("a")]);
    moveTo(state, "a", T0);
    expect(() => recordAttempt(state, deps, "good", at(1))).toThrow(/no cue/i);
  });

  it("does not mutate the caller's context snapshot", () => {
    const skills = [skill("a", { stability: 10 })];
    const { state, deps } = setup(skills);
    moveTo(state, "a", T0);
    serveNextPrompt(state, deps, T0);
    recordAttempt(state, deps, "good", at(1));
    finishBlock(state, deps, at(1));
    expect(skills[0].stability).toBe(10);
    expect(state.skills[0].stability).not.toBe(10);
  });
});

describe("finishBlock", () => {
  it("applies the block's WORST grade, not its last or its average", () => {
    // A skill where one cue came back cleanly and another didn't is not a skill
    // that was recalled — the failure is the informative part.
    const { state, deps } = setup([skill("a")]);
    moveTo(state, "a", T0);
    for (const g of ["easy", "again", "good"] as const) {
      serveNextPrompt(state, deps, at(1));
      recordAttempt(state, deps, g, at(2));
    }
    const outcome = finishBlock(state, deps, at(3))!;
    expect(outcome.aggregateGrade).toBe("again");
    expect(outcome.sAfter).toBeLessThan(outcome.sBefore!);
  });

  it("advances the skill exactly once for the whole block", () => {
    const { state, deps } = setup([skill("a", { stability: 10 })]);
    moveTo(state, "a", T0);
    for (let i = 0; i < 3; i++) {
      serveNextPrompt(state, deps, at(i));
      recordAttempt(state, deps, "good", at(i + 0.5));
    }
    const outcome = finishBlock(state, deps, at(4))!;
    expect(state.skills[0].stability).toBeCloseTo(outcome.sAfter, 12);
    expect(state.skills[0].lastReviewedAt).toEqual(at(4));
  });

  it("returns null when the learner answered nothing", () => {
    // Opening a skill and switching away is not an observation, and writing a
    // review event for it would be inventing data.
    const { state, deps } = setup([skill("a")]);
    moveTo(state, "a", T0);
    serveNextPrompt(state, deps, T0);
    expect(finishBlock(state, deps, at(1))).toBeNull();
  });

  it("does not re-aggregate a block that already settled", () => {
    const { state, deps } = setup([skill("a"), skill("b")]);
    moveTo(state, "a", T0);
    serveNextPrompt(state, deps, T0);
    recordAttempt(state, deps, "good", at(1));
    expect(finishBlock(state, deps, at(1))).not.toBeNull();
    expect(finishBlock(state, deps, at(2))).toBeNull();
  });

  it("aggregates each block separately when a skill is revisited", () => {
    const { state, deps } = setup([skill("a"), skill("b")]);

    moveTo(state, "a", T0);
    serveNextPrompt(state, deps, T0);
    recordAttempt(state, deps, "again", at(1));
    expect(finishBlock(state, deps, at(1))!.aggregateGrade).toBe("again");

    moveTo(state, "b", at(1));
    serveNextPrompt(state, deps, at(1));
    recordAttempt(state, deps, "good", at(2));
    finishBlock(state, deps, at(2));

    moveTo(state, "a", at(2));
    serveNextPrompt(state, deps, at(2));
    recordAttempt(state, deps, "easy", at(3));
    // The earlier `again` must not leak into this block's aggregate.
    expect(finishBlock(state, deps, at(3))!.aggregateGrade).toBe("easy");
  });
});

describe("emergent block length", () => {
  it("keeps the block going until fatigue moves the utilities past epsilon", () => {
    // The §7 invariant, end to end: nothing here consults a clock or a configured
    // length. The block ends because the numbers moved.
    const { state, deps } = setup([
      skill("logic", { channelLoadings: LOGICAL }),
      skill("guitar", { channelLoadings: MOTOR }),
    ]);
    moveTo(state, "logic", T0);

    let switchedAfter: number | null = null;
    for (let i = 0; i < 40 && switchedAfter === null; i++) {
      serveNextPrompt(state, deps, at(i * 2));
      recordAttempt(state, deps, "good", at(i * 2 + 2));
      if (evaluateSwitch(state, deps, at(i * 2 + 2)).shouldSwitch) {
        switchedAfter = i + 1;
      }
    }

    expect(switchedAfter).not.toBeNull();
    // Not on the first attempt — hysteresis holds the block together...
    expect(switchedAfter!).toBeGreaterThan(1);
    // ...and not never, because fatigue does accumulate.
    expect(switchedAfter!).toBeLessThan(40);
  });

  it("holds a longer block when epsilon is larger, with nothing else changed", () => {
    // epsilon is the sole granularity control (§7), which is what makes §11's
    // block-granularity experiment a single-parameter manipulation.
    const runWith = (epsilon: number) => {
      const { state, deps } = setup(
        [
          skill("logic", { channelLoadings: LOGICAL }),
          skill("guitar", { channelLoadings: MOTOR }),
        ],
        { config: { ...DEFAULT_CONFIG, epsilon } }
      );
      moveTo(state, "logic", T0);
      for (let i = 0; i < 40; i++) {
        serveNextPrompt(state, deps, at(i * 2));
        recordAttempt(state, deps, "good", at(i * 2 + 2));
        if (evaluateSwitch(state, deps, at(i * 2 + 2)).shouldSwitch) return i + 1;
      }
      return 40;
    };

    expect(runWith(0.5)).toBeGreaterThan(runWith(0.02));
  });

  it("never ends a block on elapsed time alone", () => {
    // One skill, nothing to switch to: no amount of elapsed time should produce a
    // switch, because there is no clock in the decision.
    const { state, deps } = setup([skill("only")]);
    moveTo(state, "only", T0);
    for (let i = 0; i < 30; i++) {
      serveNextPrompt(state, deps, at(i * 5));
      recordAttempt(state, deps, "good", at(i * 5 + 5));
      expect(evaluateSwitch(state, deps, at(i * 5 + 5)).shouldSwitch).toBe(false);
    }
  });
});

describe("rank", () => {
  it("excludes a skill whose pool emptied mid-session", () => {
    const { state, deps } = setup([skill("a"), skill("b")]);
    state.skills.find((s) => s.id === "b")!.promptPoolSize = 0;
    const { ranked, excluded } = rank(state, deps, T0);
    expect(ranked.map((r) => r.skillId)).toEqual(["a"]);
    expect(excluded[0]).toMatchObject({ skillId: "b", reason: "no_prompts" });
  });
});
