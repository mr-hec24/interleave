import { describe, it, expect } from "vitest";
import {
  rankSkills,
  decideSwitch,
  computeUtility,
  toUVector,
  simContextFor,
  type CandidateSkill,
  type RankingInput,
} from "../controller";
import { DEFAULT_CONFIG, configFromRow, type SchedulerConfig } from "../config";
import { buildSimilarityGraph } from "../similarity";
import { UNIFORM_LOADING, ZERO_SATURATION } from "../fatigue";
import type { PrereqEdge } from "../readiness";

const NOW = new Date("2026-08-03T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000);

function skill(over: Partial<CandidateSkill> & { id: string }): CandidateSkill {
  return {
    name: over.id,
    stability: 10,
    difficulty: 5,
    channelLoadings: UNIFORM_LOADING,
    priorityWeight: 1,
    lastReviewedAt: daysAgo(30),
    promptPoolSize: 3,
    ...over,
  };
}

function input(over: Partial<RankingInput> = {}): RankingInput {
  return {
    skills: [],
    now: NOW,
    config: DEFAULT_CONFIG,
    saturation: ZERO_SATURATION,
    prereqEdges: [],
    similarityGraph: buildSimilarityGraph([]),
    recentPractice: [],
    ...over,
  };
}

describe("rankSkills — exclusions are exclusions, not penalties", () => {
  it("excludes a skill with an empty cue pool, with a reason", () => {
    // Scheduling it would manufacture an undefined measurement.
    const { ranked, excluded } = rankSkills(
      input({ skills: [skill({ id: "no_cues", promptPoolSize: 0 })] })
    );
    expect(ranked).toHaveLength(0);
    expect(excluded).toEqual([
      { skillId: "no_cues", skillName: "no_cues", reason: "no_prompts", unmetPrereqs: [] },
    ]);
  });

  it("excludes an unreachable skill and names the blocking prerequisite", () => {
    const edges: PrereqEdge[] = [{ skillId: "advanced", prereqSkillId: "basics" }];
    const { ranked, excluded } = rankSkills(
      input({
        skills: [skill({ id: "advanced" }), skill({ id: "basics", stability: 0.5 })],
        prereqEdges: edges,
      })
    );
    expect(ranked.map((r) => r.skillId)).toEqual(["basics"]);
    expect(excluded).toEqual([
      {
        skillId: "advanced",
        skillName: "advanced",
        reason: "unreachable",
        unmetPrereqs: ["basics"],
      },
    ]);
  });

  it("does NOT let a locked skill outrank a reachable one with negative utility", () => {
    // The §6 trap. Under multiplicative gating, 1[false] * (-0.4) = 0 > -0.4, so
    // the locked skill would win the argmax exactly when the learner is fatigued.
    const heavyFatigue = [1, 1, 1, 1];
    const edges: PrereqEdge[] = [{ skillId: "locked", prereqSkillId: "missing" }];

    const { ranked, excluded } = rankSkills(
      input({
        skills: [
          skill({ id: "locked", lastReviewedAt: daysAgo(0), stability: 1000 }),
          skill({ id: "open", lastReviewedAt: daysAgo(0), stability: 1000 }),
          skill({ id: "missing", stability: null }),
        ],
        prereqEdges: edges,
        saturation: heavyFatigue,
        config: { ...DEFAULT_CONFIG, beta: 5 },
      })
    );

    // `open` has genuinely negative utility here...
    const open = ranked.find((r) => r.skillId === "open")!;
    expect(open.utility).toBeLessThan(0);
    // ...and the locked skill still must not appear above it, because it does not
    // appear at all.
    expect(ranked.map((r) => r.skillId)).not.toContain("locked");
    expect(excluded.map((e) => e.skillId)).toContain("locked");
  });

  it("checks the cue pool before reachability", () => {
    const edges: PrereqEdge[] = [{ skillId: "both", prereqSkillId: "missing" }];
    const { excluded } = rankSkills(
      input({
        skills: [skill({ id: "both", promptPoolSize: 0 })],
        prereqEdges: edges,
      })
    );
    // Without a cue there is nothing to schedule regardless of prerequisites.
    expect(excluded[0].reason).toBe("no_prompts");
  });
});

describe("rankSkills — ordering", () => {
  it("prefers the skill nearer the desirable-difficulty band", () => {
    const { ranked } = rankSkills(
      input({
        skills: [
          skill({ id: "just_done", lastReviewedAt: daysAgo(0) }),
          skill({ id: "due", lastReviewedAt: daysAgo(100) }),
        ],
      })
    );
    expect(ranked[0].skillId).toBe("due");
  });

  it("prefers a fresh channel after heavy load on another", () => {
    // The mechanism the cross-domain claim rests on, end to end through the
    // controller rather than only in the fatigue unit.
    const LOGICAL = [1, 0, 0, 0];
    const MOTOR = [0, 0, 0, 1];
    const afterDebugging = [0.95, 0, 0, 0];

    const { ranked } = rankSkills(
      input({
        skills: [
          skill({ id: "more_logic", channelLoadings: LOGICAL }),
          skill({ id: "guitar", channelLoadings: MOTOR }),
        ],
        saturation: afterDebugging,
      })
    );
    expect(ranked[0].skillId).toBe("guitar");
  });

  it("suppresses a skill semantically adjacent to the previous block", () => {
    // Ids chosen so the French skill wins the alphabetical tie-break: if
    // interference did nothing, `a_imparfait` would stay on top and this test
    // would fail rather than pass for the wrong reason.
    const graph = buildSimilarityGraph([
      { skillA: "a_imparfait", skillB: "a_passe_compose", sim: 0.9 },
    ]);
    const skills = [
      skill({ id: "a_imparfait" }),
      skill({ id: "z_guitar" }),
      skill({ id: "a_passe_compose" }),
    ];

    const withoutRecency = rankSkills(input({ skills, similarityGraph: graph }));
    const afterFrench = rankSkills(
      input({
        skills,
        similarityGraph: graph,
        recentPractice: [{ skillId: "a_passe_compose", blocksAgo: 1 }],
      })
    );

    const rank = (r: typeof withoutRecency, id: string) =>
      r.ranked.findIndex((x) => x.skillId === id);

    // All three are equally due, so with no recent practice the alphabetical
    // tie-break decides and the French skill leads the unrelated one.
    expect(rank(withoutRecency, "a_imparfait")).toBeLessThan(
      rank(withoutRecency, "z_guitar")
    );

    // Once the semantically adjacent French skill has just been practised, that
    // ordering inverts — which is the whole content of the interference term.
    expect(rank(afterFrench, "z_guitar")).toBeLessThan(rank(afterFrench, "a_imparfait"));

    const imparfait = afterFrench.ranked.find((r) => r.skillId === "a_imparfait")!;
    expect(imparfait.interference).toBeCloseTo(0.9, 10);
    expect(imparfait.interferenceFrom).toEqual({ skillId: "a_passe_compose", sim: 0.9 });
    // And the unrelated skill is untouched by it — the cross-domain case.
    expect(afterFrench.ranked.find((r) => r.skillId === "z_guitar")!.interference).toBe(0);
  });

  it("is deterministic on ties", () => {
    // A ranking that reshuffles on equal scores reads as the scheduler changing
    // its mind for no reason.
    const skills = [skill({ id: "c" }), skill({ id: "a" }), skill({ id: "b" })];
    const first = rankSkills(input({ skills })).ranked.map((r) => r.skillId);
    const again = rankSkills(input({ skills: [...skills].reverse() })).ranked.map(
      (r) => r.skillId
    );
    expect(first).toEqual(["a", "b", "c"]);
    expect(again).toEqual(first);
  });

  it("carries the full component breakdown on every entry", () => {
    // §10 requires u_vector on switches and the trust argument requires the same
    // numbers on screen. One structure serves both so they cannot diverge.
    const { ranked } = rankSkills(input({ skills: [skill({ id: "a" })] }));
    expect(ranked[0]).toMatchObject({
      skillId: "a",
      urgency: expect.any(Number),
      fatigue: expect.any(Number),
      readiness: expect.any(Number),
      interference: expect.any(Number),
      utility: expect.any(Number),
      retrievability: expect.any(Number),
    });
  });
});

describe("computeUtility — weights", () => {
  const components = { urgency: 1, fatigue: 0.5, readiness: 0.8, interference: 0.2 };

  it("applies the §7 formula", () => {
    const c = DEFAULT_CONFIG;
    expect(computeUtility(components, c, 1)).toBeCloseTo(
      c.alpha * 1 - c.beta * 0.5 + c.gamma * 0.8 - c.delta * 0.2,
      12
    );
  });

  it("honours a beta = 0 ablation arm", () => {
    // §11 requires this to be possible; a compiled-in beta would make it not.
    const ablated: SchedulerConfig = { ...DEFAULT_CONFIG, beta: 0 };
    const withFatigue = computeUtility(components, ablated, 1);
    const noFatigue = computeUtility({ ...components, fatigue: 0 }, ablated, 1);
    expect(withFatigue).toBeCloseTo(noFatigue, 12);
  });

  it("honours a delta = 0 interference control arm", () => {
    const control: SchedulerConfig = { ...DEFAULT_CONFIG, delta: 0 };
    expect(computeUtility(components, control, 1)).toBeCloseTo(
      computeUtility({ ...components, interference: 0 }, control, 1),
      12
    );
  });

  it("scales by priority weight rather than offsetting", () => {
    // An important skill should be MORE responsive to becoming due, not
    // permanently shifted upward whether or not it needs attention.
    const urgent = { urgency: 1, fatigue: 0, readiness: 0, interference: 0 };
    const notUrgent = { urgency: 0, fatigue: 0, readiness: 0, interference: 0 };
    expect(computeUtility(urgent, DEFAULT_CONFIG, 2)).toBeGreaterThan(
      computeUtility(urgent, DEFAULT_CONFIG, 1)
    );
    expect(computeUtility(notUrgent, DEFAULT_CONFIG, 2)).toBeCloseTo(
      computeUtility(notUrgent, DEFAULT_CONFIG, 1),
      12
    );
  });
});

describe("decideSwitch — hysteresis", () => {
  const ranking = (entries: Array<[string, number]>) => ({
    ranked: entries.map(([skillId, utility]) => ({
      skillId,
      skillName: skillId,
      urgency: 0,
      fatigue: 0,
      readiness: 0,
      interference: 0,
      utility,
      retrievability: 0,
      interferenceFrom: null,
    })),
    excluded: [],
  });

  it("picks outright at session start", () => {
    const d = decideSwitch(ranking([["a", 0.9], ["b", 0.2]]), null, DEFAULT_CONFIG);
    expect(d.shouldSwitch).toBe(true);
    expect(d.target!.skillId).toBe("a");
  });

  it("stays put when the rival leads by less than epsilon", () => {
    // Pure argmax chatters here: without the margin the system thrashes at the
    // crossover as fatigue drags the incumbent down.
    const d = decideSwitch(
      ranking([["rival", 0.55], ["current", 0.5]]),
      "current",
      DEFAULT_CONFIG // epsilon 0.15
    );
    expect(d.shouldSwitch).toBe(false);
    expect(d.target).toBeNull();
    expect(d.margin).toBeCloseTo(0.05, 12);
  });

  it("switches once the rival clears epsilon", () => {
    const d = decideSwitch(
      ranking([["rival", 0.7], ["current", 0.5]]),
      "current",
      DEFAULT_CONFIG
    );
    expect(d.shouldSwitch).toBe(true);
    expect(d.target!.skillId).toBe("rival");
    expect(d.margin).toBeCloseTo(0.2, 12);
  });

  it("is strict at exactly epsilon", () => {
    // Values chosen so the margin is exactly epsilon with no floating-point
    // residue — 0.65 - 0.5 is 0.15000000000000002, which legitimately clears a
    // strict `>` and would test the float, not the policy.
    const d = decideSwitch(
      ranking([["rival", DEFAULT_CONFIG.epsilon], ["current", 0]]),
      "current",
      DEFAULT_CONFIG
    );
    expect(d.margin).toBe(DEFAULT_CONFIG.epsilon);
    expect(d.shouldSwitch).toBe(false);
  });

  it("epsilon is the sole granularity control", () => {
    // §11 randomises epsilon across users to test block granularity. Small epsilon
    // = rapid interleaving, large = long focused blocks, and nothing else in the
    // system sets block length.
    const r = ranking([["rival", 0.6], ["current", 0.5]]);
    expect(decideSwitch(r, "current", { ...DEFAULT_CONFIG, epsilon: 0.01 }).shouldSwitch)
      .toBe(true);
    expect(decideSwitch(r, "current", { ...DEFAULT_CONFIG, epsilon: 0.5 }).shouldSwitch)
      .toBe(false);
  });

  it("does not switch when the incumbent is the only candidate", () => {
    const d = decideSwitch(ranking([["current", 0.5]]), "current", DEFAULT_CONFIG);
    expect(d.shouldSwitch).toBe(false);
    expect(d.incumbent!.skillId).toBe("current");
  });

  it("moves immediately if the incumbent left the candidate set mid-block", () => {
    // Its cue pool was emptied, or a prerequisite edge was added. Continuing would
    // put ungradeable events in the log.
    const d = decideSwitch(ranking([["other", 0.1]]), "vanished", DEFAULT_CONFIG);
    expect(d.shouldSwitch).toBe(true);
    expect(d.target!.skillId).toBe("other");
  });

  it("does nothing when there are no candidates at all", () => {
    const d = decideSwitch(ranking([]), "current", DEFAULT_CONFIG);
    expect(d.shouldSwitch).toBe(false);
    expect(d.target).toBeNull();
  });

  it("reports epsilon alongside the margin so the log is self-describing", () => {
    const d = decideSwitch(ranking([["a", 1], ["b", 0]]), "b", DEFAULT_CONFIG);
    expect(d.epsilon).toBe(DEFAULT_CONFIG.epsilon);
  });
});

describe("emergent session length", () => {
  it("ends a block only when fatigue has moved the utilities past epsilon", () => {
    // No block-duration parameter exists. This walks a block forward and checks
    // the switch is caused by accumulating fatigue, not by a clock.
    const LOGICAL = [1, 0, 0, 0];
    const MOTOR = [0, 0, 0, 1];
    const skills = [
      skill({ id: "logic", channelLoadings: LOGICAL, lastReviewedAt: daysAgo(60) }),
      skill({ id: "guitar", channelLoadings: MOTOR, lastReviewedAt: daysAgo(60) }),
    ];

    let saturation = [...ZERO_SATURATION];
    let switchedAtStep: number | null = null;

    for (let step = 1; step <= 60 && switchedAtStep === null; step++) {
      // One minute of logical practice per step.
      saturation = [
        1 - (1 - saturation[0]) * Math.exp(-1 / DEFAULT_CONFIG.fatigue.tauMinutes[0]),
        saturation[1],
        saturation[2],
        saturation[3],
      ];
      const decision = decideSwitch(
        rankSkills(input({ skills, saturation })),
        "logic",
        DEFAULT_CONFIG
      );
      if (decision.shouldSwitch) switchedAtStep = step;
    }

    expect(switchedAtStep).not.toBeNull();
    // Not instantly (hysteresis holds it), and not never (fatigue does accumulate).
    expect(switchedAtStep!).toBeGreaterThan(3);
    expect(switchedAtStep!).toBeLessThan(60);
  });
});

describe("toUVector / simContextFor", () => {
  it("trims u_vector to top-k with components intact", () => {
    const { ranked } = rankSkills(
      input({
        skills: [skill({ id: "a" }), skill({ id: "b" }), skill({ id: "c" })],
      })
    );
    const uv = toUVector(ranked, 2);
    expect(uv).toHaveLength(2);
    expect(uv[0]).toHaveProperty("urgency");
    expect(uv[0]).not.toHaveProperty("retrievability");
  });

  it("reports sim_context against the previous block", () => {
    const graph = buildSimilarityGraph([{ skillA: "a", skillB: "b", sim: 0.77 }]);
    expect(simContextFor(graph, "a", "b")).toBeCloseTo(0.77, 10);
    expect(simContextFor(graph, "a", null)).toBe(0);
  });
});

describe("configFromRow", () => {
  it("parses Postgres numerics delivered as strings", () => {
    // PostgREST sends `numeric` as a string because it is arbitrary precision.
    // Uncoerced, alpha * urgency becomes string concatenation or NaN and the
    // scheduler produces nonsense instead of failing.
    const config = configFromRow({
      alpha: "1.5",
      beta: "0.25",
      gamma: "0.5",
      delta: "0.3",
      epsilon: "0.2",
      theta: "0.4",
      sigma: "0.1",
      tau_minutes: ["45", "50", "55", "60"],
      rho_minutes: ["70", "75", "80", "85"],
      sim_threshold: "0.65",
      sim_degree_cap: "8",
    });
    expect(config.alpha).toBe(1.5);
    expect(typeof config.alpha).toBe("number");
    expect(config.fatigue.tauMinutes).toEqual([45, 50, 55, 60]);
    expect(config.simDegreeCap).toBe(8);
  });

  it("falls back to defaults for a null row or unparseable fields", () => {
    expect(configFromRow(null)).toEqual(DEFAULT_CONFIG);
    const partial = configFromRow({ alpha: "not-a-number", beta: 0.9 });
    expect(partial.alpha).toBe(DEFAULT_CONFIG.alpha);
    expect(partial.beta).toBe(0.9);
  });

  it("rejects a wrong-length channel array rather than mis-indexing", () => {
    const config = configFromRow({ tau_minutes: ["10", "20"] });
    expect(config.fatigue.tauMinutes).toEqual(DEFAULT_CONFIG.fatigue.tauMinutes);
  });
});
