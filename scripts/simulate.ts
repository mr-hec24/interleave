/**
 * Interleave Simulator — synthetic learner against the real v1 loop.
 *
 *   npx tsx scripts/simulate.ts             # policy comparison
 *   npx tsx scripts/simulate.ts --epsilon   # §11 block-granularity sweep
 *   npx tsx scripts/simulate.ts --csv       # write scripts/results.csv
 *
 * The simulator imports the REAL controller, memory model, fatigue model, and
 * session engine — never a reimplementation. That is the property that makes it
 * worth anything: a bug in the scheduler shows up here, and a result here is a
 * statement about the shipped code rather than about a model of it.
 *
 * ## What it can and cannot tell you
 *
 * The synthetic learner has a ground-truth memory the app never sees, so the
 * simulator can measure whether the scheduler's decisions actually preserve
 * retention. What it cannot do is validate the model against people: the learner's
 * decay is exponential because we made it so, and per-prompt difficulty varies
 * because we made it vary. §11's experiments are the real test; this is the cheap
 * pre-flight that catches a policy which is obviously broken before it reaches
 * anyone.
 */

import {
  rankSkills as rankV1,
  decideSwitch,
  type CandidateSkill,
} from "../src/lib/v1/controller";
import { DEFAULT_CONFIG, type SchedulerConfig } from "../src/lib/v1/config";
import { applyReview, type MemoryState } from "../src/lib/v1/memory";
import {
  chargeAfterSession,
  decayAfterIdle,
  ZERO_SATURATION,
} from "../src/lib/v1/fatigue";
import { buildSimilarityGraph } from "../src/lib/v1/similarity";
import type { Grade } from "../src/lib/v1/grade";
import type { RecentPractice } from "../src/lib/v1/interference";
import * as fs from "fs";

// ─── Deterministic RNG ───────────────────────────────────────────────────────
//
// Injected rather than patched over the global. The previous version replaced
// `Math.random` for the duration of a run, which silently affected anything else
// executing in the same process and made two policies share a stream.

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// ─── Synthetic learner (ground truth the app never sees) ─────────────────────

/**
 * ## The one assumption baked into the ground truth: the spacing effect
 *
 * The synthetic learner's true stability grows more from a successful retrieval made
 * at *low* retrievability than at high — a retrieval you nearly failed teaches more
 * than one that was never in doubt. Without that, waiting has no upside in this
 * world: any policy that practises everything constantly accumulates more successful
 * blocks and therefore more stability, and round-robin beats every spacing-aware
 * schedule by construction.
 *
 * This is deliberate and it bounds what the simulator can claim. **It cannot be
 * evidence that the spacing effect is real** — it assumes it. What it can show is
 * whether the controller *exploits* a spacing effect efficiently once one exists,
 * which is a question about the code rather than about memory. The empirical
 * question stays where §11 puts it.
 */
interface SkillConfig {
  name: string;
  /** Days until true recall falls to ~37%. */
  initialStability: number;
  /** Peak multiplier on true stability, reached when a retrieval was hard-won. */
  learningGain: number;
  /** λ_i — which channels this skill tires. */
  channelLoadings: number[];
  /** Per-cue difficulty offsets, so pools are heterogeneous like real ones. */
  cueDifficulty: number[];
}

const LOGICAL = [0.8, 0.15, 0.05, 0];
const VERBAL = [0.15, 0.75, 0.1, 0];
const MOTOR = [0.05, 0.05, 0.2, 0.7];
const VISUAL = [0.15, 0.05, 0.75, 0.05];

const SKILL_CONFIGS: SkillConfig[] = [
  { name: "Spanish subjunctive", initialStability: 1.5, learningGain: 2.6, channelLoadings: VERBAL, cueDifficulty: [1.0, 0.85, 1.15] },
  { name: "Piano ii-V-I comping", initialStability: 2.0, learningGain: 2.4, channelLoadings: MOTOR, cueDifficulty: [1.0, 1.1, 0.9] },
  { name: "Backprop math", initialStability: 1.0, learningGain: 2.8, channelLoadings: LOGICAL, cueDifficulty: [1.0, 0.8, 1.2] },
  { name: "French reading", initialStability: 2.5, learningGain: 2.2, channelLoadings: VERBAL, cueDifficulty: [1.0, 1.05, 0.95] },
  { name: "Drawing perspective", initialStability: 1.8, learningGain: 2.5, channelLoadings: VISUAL, cueDifficulty: [1.0, 0.9, 1.1] },
];

const SIM_DAYS = 90;
const BLOCKS_PER_DAY = 3;
const ATTEMPTS_PER_BLOCK = 3;
const MINUTES_PER_ATTEMPT = 4;
/** Idle time between practice days, for fatigue recovery. */
const OVERNIGHT_MINUTES = 20 * 60;

interface LatentSkill {
  trueStability: number;
  lastPracticedDay: number;
}

function trueRetrievability(daysSince: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.exp(-daysSince / stability);
}

/**
 * Grades a retrieval by treating retrievability as what it is: a probability.
 *
 * The earlier version thresholded R against a fixed cutoff, which quietly made the
 * outcome deterministic and put the failure boundary somewhere the model never
 * claimed it was. Sampling against R is the definition, and it has a consequence
 * worth stating plainly: **§4's target of θ = 0.35 means roughly two thirds of
 * scheduled reviews are expected to fail.** That is a deliberate choice in the spec
 * — retrieval near the edge of forgetting is what the desirable-difficulty argument
 * asks for — but it sits a long way from the ~0.9 desired retention that FSRS and
 * Anki default to, and it interacts sharply with how hard a lapse is punished.
 */
function gradeFrom(rTrue: number, cueDifficulty: number, rand: () => number): Grade {
  const p = Math.min(1, rTrue / cueDifficulty);
  if (rand() >= p) return "again";
  // It came back. How easily depends on how much headroom there was.
  if (p < 0.5) return "hard";
  if (p < 0.85) return "good";
  return "easy";
}

const GRADE_ORDER: Grade[] = ["again", "hard", "good", "easy"];
const worst = (a: Grade, b: Grade) =>
  GRADE_ORDER.indexOf(a) < GRADE_ORDER.indexOf(b) ? a : b;

// ─── Policies ────────────────────────────────────────────────────────────────

type Policy = (ctx: {
  skills: CandidateSkill[];
  saturation: number[];
  recentPractice: RecentPractice[];
  current: string | null;
  now: Date;
  config: SchedulerConfig;
  rand: () => number;
}) => string | null;

/** The real v1 controller, hysteresis and all. */
const utilityPolicy: Policy = ({ skills, saturation, recentPractice, current, now, config }) => {
  const ranking = rankV1({
    skills,
    now,
    config,
    saturation,
    prereqEdges: [],
    similarityGraph: buildSimilarityGraph([]),
    recentPractice,
  });
  if (ranking.ranked.length === 0) return null;
  const decision = decideSwitch(ranking, current, config);
  if (decision.shouldSwitch && decision.target) return decision.target.skillId;
  return current ?? ranking.ranked[0].skillId;
};

/** Urgency only — the §11 β = 0 ablation arm for the fatigue term. */
const noFatiguePolicy: Policy = (ctx) =>
  utilityPolicy({ ...ctx, config: { ...ctx.config, beta: 0 } });

const blockedPolicy: Policy = ({ skills, now }) => {
  const day = Math.floor(now.getTime() / 86400000);
  return skills[Math.floor(day / 10) % skills.length].id;
};

const randomPolicy: Policy = ({ skills, rand }) =>
  skills[Math.floor(rand() * skills.length)].id;

const roundRobinPolicy: Policy = ({ skills, now }) => {
  const day = Math.floor(now.getTime() / 86400000);
  return skills[day % skills.length].id;
};

// ─── Engine ──────────────────────────────────────────────────────────────────

/**
 * Days of no practice before the durability measurement.
 *
 * The headline metric has to be retention *after a washout*, not on the last day of
 * practice. End-of-run retrievability rewards recency: a policy that touches every
 * skill constantly ends with everything fresh and scores highest, even while doing
 * far more redundant work. Measured that way, round-robin beats the utility policy —
 * which says nothing about learning and everything about the metric.
 *
 * A washout asks the question the product actually makes: two weeks after you stop,
 * what is still there? That is a function of the stability the schedule built, which
 * is what spacing is for.
 */
const WASHOUT_DAYS = 14;

interface SimResult {
  policy: string;
  meanRetention: number;
  minRetention: number;
  /** Mean true retrievability WASHOUT_DAYS after practice stops. The real one. */
  durableRetention: number;
  durableMin: number;
  skillsAbove80: number;
  wastedBlocks: number;
  lapses: number;
  blocks: number;
  meanBlockAttempts: number;
  switches: number;
  /** The learner's true stability at the end — shows whether practice accumulated. */
  meanTrueStability: number;
  dailyRetention: number[];
}

function runSimulation(
  policyName: string,
  policy: Policy,
  config: SchedulerConfig,
  seed = 42
): SimResult {
  const rand = makeRng(seed);
  const t0 = new Date("2026-01-01T08:00:00Z");

  const skills: CandidateSkill[] = SKILL_CONFIGS.map((c, i) => ({
    id: c.name,
    name: c.name,
    stability: null,
    difficulty: 5,
    channelLoadings: c.channelLoadings,
    priorityWeight: 1,
    lastReviewedAt: null,
    promptPoolSize: c.cueDifficulty.length,
    // Deterministic per-skill cue rotation.
    ...({ _cursor: i } as object),
  }));
  const cursor = new Map<string, number>(skills.map((s) => [s.id, 0]));
  const latent = new Map<string, LatentSkill>(
    SKILL_CONFIGS.map((c) => [c.name, { trueStability: c.initialStability, lastPracticedDay: -1 }])
  );

  let saturation = [...ZERO_SATURATION];
  let current: string | null = null;
  let recentPractice: RecentPractice[] = [];

  let wastedBlocks = 0;
  let lapses = 0;
  let blocks = 0;
  let totalAttempts = 0;
  let switches = 0;
  const dailyRetention: number[] = [];

  for (let day = 0; day < SIM_DAYS; day++) {
    for (let b = 0; b < BLOCKS_PER_DAY; b++) {
      const now = new Date(t0.getTime() + day * 86400000 + b * 90 * 60000);
      const chosen = policy({
        skills,
        saturation,
        recentPractice,
        current,
        now,
        config,
        rand,
      });
      if (!chosen) continue;
      if (current !== null && chosen !== current) switches++;
      current = chosen;

      const skill = skills.find((s) => s.id === chosen)!;
      const cfg = SKILL_CONFIGS.find((c) => c.name === chosen)!;
      const lat = latent.get(chosen)!;

      const daysSince = lat.lastPracticedDay < 0 ? 999 : day - lat.lastPracticedDay;
      const rTrue = trueRetrievability(daysSince, lat.trueStability);
      if (rTrue > 0.95) wastedBlocks++;
      if (rTrue < 0.3) lapses++;

      // A block is several attempts against different cues; the skill's state
      // advances once, on the block's worst grade — matching the shipped engine.
      let blockGrade: Grade = "easy";
      for (let a = 0; a < ATTEMPTS_PER_BLOCK; a++) {
        const idx = cursor.get(chosen)!;
        cursor.set(chosen, (idx + 1) % cfg.cueDifficulty.length);
        blockGrade = worst(blockGrade, gradeFrom(rTrue, cfg.cueDifficulty[idx], rand));
        totalAttempts++;
        saturation = chargeAfterSession(
          saturation,
          skill.channelLoadings,
          MINUTES_PER_ATTEMPT,
          config.fatigue
        );
      }
      blocks++;

      const before: MemoryState = { stability: skill.stability, difficulty: skill.difficulty };
      const elapsedDays = skill.lastReviewedAt
        ? (now.getTime() - skill.lastReviewedAt.getTime()) / 86400000
        : 0;
      const { next } = applyReview(before, elapsedDays, blockGrade);
      skill.stability = next.stability;
      skill.difficulty = next.difficulty;
      skill.lastReviewedAt = now;

      if (blockGrade === "again") {
        // Relearning. Without this the learner has an absorbing failure state: a
        // skill that decays past the point where retrieval succeeds grades `again`
        // forever, never gains, and can never come back — so every policy ends with
        // at least one dead skill and the comparison degenerates. A real lapse
        // costs stability but leaves the trace re-buildable.
        lat.trueStability = Math.max(cfg.initialStability, lat.trueStability * 0.7);
      } else {
        // The spacing effect, in the ground truth. A success at R≈0.95 barely moves
        // stability; one at R≈0.4 moves it a lot. See the note on SkillConfig for
        // what this does and does not license the simulator to claim.
        const gain = 1 + (cfg.learningGain - 1) * (1 - rTrue);
        lat.trueStability = Math.min(lat.trueStability * gain, 120);
      }
      lat.lastPracticedDay = day;

      recentPractice = [
        { skillId: chosen, blocksAgo: 1 },
        ...recentPractice
          .filter((r) => r.skillId !== chosen)
          .map((r) => ({ ...r, blocksAgo: r.blocksAgo + 1 })),
      ];
    }

    saturation = decayAfterIdle(saturation, OVERNIGHT_MINUTES, config.fatigue);

    let sum = 0;
    for (const c of SKILL_CONFIGS) {
      const l = latent.get(c.name)!;
      const ds = l.lastPracticedDay < 0 ? 999 : day - l.lastPracticedDay;
      sum += trueRetrievability(ds, l.trueStability);
    }
    dailyRetention.push(sum / SKILL_CONFIGS.length);
  }

  const retentionAt = (dayOffset: number) =>
    SKILL_CONFIGS.map((c) => {
      const l = latent.get(c.name)!;
      const ds = l.lastPracticedDay < 0 ? 999 : SIM_DAYS - 1 + dayOffset - l.lastPracticedDay;
      return trueRetrievability(ds, l.trueStability);
    });

  const finals = retentionAt(0);
  const durable = retentionAt(WASHOUT_DAYS);

  return {
    policy: policyName,
    meanRetention: finals.reduce((a, b) => a + b, 0) / finals.length,
    minRetention: Math.min(...finals),
    durableRetention: durable.reduce((a, b) => a + b, 0) / durable.length,
    durableMin: Math.min(...durable),
    skillsAbove80: durable.filter((r) => r > 0.8).length,
    wastedBlocks,
    lapses,
    blocks,
    meanBlockAttempts: blocks === 0 ? 0 : totalAttempts / blocks,
    switches,
    meanTrueStability:
      SKILL_CONFIGS.reduce((a, c) => a + latent.get(c.name)!.trueStability, 0) /
      SKILL_CONFIGS.length,
    dailyRetention,
  };
}

// ─── Output ──────────────────────────────────────────────────────────────────

function printTable(results: SimResult[]) {
  console.log("\n" + "═".repeat(96));
  console.log(
    `  INTERLEAVE SIMULATOR — ${SIM_DAYS} days, ${SKILL_CONFIGS.length} skills, ${BLOCKS_PER_DAY} blocks/day`
  );
  console.log("═".repeat(96));
  console.log(
    [
      "Policy".padEnd(28),
      "Durable".padStart(8),
      "D-min".padStart(8),
      ">80%".padStart(6),
      "Day90".padStart(7),
      "Wasted".padStart(7),
      "Lapses".padStart(7),
      "Mean S".padStart(7),
    ].join(" │ ")
  );
  console.log("─".repeat(96));
  for (const r of [...results].sort((a, b) => b.durableRetention - a.durableRetention)) {
    console.log(
      [
        r.policy.padEnd(28),
        `${(r.durableRetention * 100).toFixed(1)}%`.padStart(8),
        `${(r.durableMin * 100).toFixed(1)}%`.padStart(8),
        `${r.skillsAbove80}/${SKILL_CONFIGS.length}`.padStart(6),
        `${(r.meanRetention * 100).toFixed(0)}%`.padStart(7),
        String(r.wastedBlocks).padStart(7),
        String(r.lapses).padStart(7),
        `${r.meanTrueStability.toFixed(1)}d`.padStart(7),
      ].join(" │ ")
    );
  }
  console.log("═".repeat(96));
  console.log(
    `\n  Durable — mean true retrievability ${WASHOUT_DAYS} days AFTER practice stops.`
  );
  console.log("            This is the headline: it measures the stability the schedule");
  console.log("            built, not which skill happened to be touched most recently.");
  console.log("  D-min   — the worst skill after washout, which is what blocking sacrifices");
  console.log("  Day90   — retention on the last day of practice. Shown for contrast only:");
  console.log("            it rewards recency, so a policy that touches everything");
  console.log("            constantly scores well on it while doing redundant work.");
  console.log("  Wasted  — blocks where true recall was already >95% (nothing to gain)");
  console.log("  Lapses  — blocks where true recall had fallen below 30%");
  console.log("  Switch  — how often the policy changed skill between blocks");
  console.log("\n  All policies get the same number of blocks, so this compares schedules");
  console.log("  at equal effort.\n");
}

/**
 * θ sweep — where reviews start building more than they cost.
 *
 * This exists because the default run collapses, and the reason is worth seeing
 * rather than tuning away. §4 targets θ ≈ 0.35: schedule each review when recall has
 * fallen to about 35%. Retrievability is a probability, so that means roughly two
 * thirds of scheduled reviews are expected to *fail*. §3 then has stability
 * "collapse toward a re-learning value" on each of those failures.
 *
 * Those two settings fight each other. Per block, expected log-stability change is
 *
 *     θ·ln(gain on success) + (1−θ)·ln(cost of a lapse)
 *
 * and with a success gain around 1.26 at θ = 0.35, that is only non-negative if a
 * lapse costs less than roughly 12% of stability. The v1 priors put it at 72%
 * (`lapseRetention` 0.28). Under those numbers, practice loses ground on average no
 * matter which policy picks the skills — which is exactly what the default table
 * shows, and it is a property of the parameters rather than of the controller.
 *
 * The sweep shows where the boundary sits. Treat it as a question for the spec, not
 * as a knob the simulator gets to turn.
 */
function printThetaSweep() {
  console.log("\n" + "═".repeat(96));
  console.log("  θ SWEEP — target retrievability vs. whether practice accumulates");
  console.log("═".repeat(96));
  console.log(
    "  θ is where §4 aims each review. Retrievability is a probability, so θ = 0.35\n" +
      "  means ~65% of reviews are expected to fail — and each failure costs stability.\n"
  );
  console.log(
    ["θ".padStart(6), "Durable".padStart(8), "D-min".padStart(8), "Lapses".padStart(7), "Mean S".padStart(8)].join(" │ ")
  );
  console.log("─".repeat(48));

  for (const theta of [0.35, 0.5, 0.65, 0.75, 0.85, 0.9]) {
    const runs = [1, 2, 3, 4, 5].map((seed) =>
      runSimulation("sweep", utilityPolicy, { ...DEFAULT_CONFIG, theta }, seed * 977)
    );
    const mean = (f: (r: SimResult) => number) =>
      runs.reduce((a, r) => a + f(r), 0) / runs.length;
    console.log(
      [
        theta.toFixed(2).padStart(6),
        `${(mean((r) => r.durableRetention) * 100).toFixed(1)}%`.padStart(8),
        `${(mean((r) => r.durableMin) * 100).toFixed(1)}%`.padStart(8),
        mean((r) => r.lapses).toFixed(0).padStart(7),
        `${mean((r) => r.meanTrueStability).toFixed(1)}d`.padStart(8),
      ].join(" │ ")
    );
  }
  console.log(
    "\n  Mean S is the synthetic learner's true stability at the end. Where it stays\n" +
      "  near its starting value, reviews are not accumulating and no scheduling\n" +
      "  policy can rescue that — the target and the lapse penalty are the problem.\n"
  );
}

/**
 * §11: "Randomise ε (block granularity) across users; retention as outcome."
 *
 * ε is the sole control on how rapidly the scheduler interleaves, so sweeping it
 * is a single-parameter manipulation of the central cross-domain claim. Running it
 * in simulation first is the cheap version of the experiment — it cannot answer the
 * question for humans, but it will show whether the mechanism does anything at all
 * in a world where the memory model is exactly right.
 */
function printEpsilonSweep() {
  console.log("\n" + "═".repeat(96));
  console.log("  ε SWEEP — block granularity vs. retention (§11)");
  console.log("═".repeat(96));
  console.log(
    "  ε is the only thing controlling how readily the scheduler switches. Small ε\n" +
      "  interleaves rapidly; large ε holds long focused blocks.\n"
  );
  console.log(
    ["ε".padStart(6), "Durable".padStart(8), "D-min".padStart(8), "Switches".padStart(9), "Blocks".padStart(7)].join(" │ ")
  );
  console.log("─".repeat(48));

  for (const epsilon of [0.01, 0.05, 0.1, 0.15, 0.3, 0.6, 1.0]) {
    // Averaged over seeds: a single run's ordering is noise, and reporting one
    // would invite reading a difference that isn't there.
    const runs = [1, 2, 3, 4, 5].map((seed) =>
      runSimulation("sweep", utilityPolicy, { ...DEFAULT_CONFIG, epsilon }, seed * 977)
    );
    const mean = (f: (r: SimResult) => number) =>
      runs.reduce((a, r) => a + f(r), 0) / runs.length;

    console.log(
      [
        epsilon.toFixed(2).padStart(6),
        `${(mean((r) => r.durableRetention) * 100).toFixed(1)}%`.padStart(8),
        `${(mean((r) => r.durableMin) * 100).toFixed(1)}%`.padStart(8),
        mean((r) => r.switches).toFixed(0).padStart(9),
        mean((r) => r.blocks).toFixed(0).padStart(7),
      ].join(" │ ")
    );
  }
  console.log(
    "\n  Averaged over 5 seeds. This is a synthetic learner whose memory is exactly\n" +
      "  the model's shape, so it cannot validate the model — only show whether the\n" +
      "  granularity control does anything under ideal conditions.\n"
  );
}

function writeCsv(results: SimResult[]) {
  const lines = ["day," + results.map((r) => r.policy).join(",")];
  for (let d = 0; d < SIM_DAYS; d++) {
    lines.push(d + "," + results.map((r) => r.dailyRetention[d].toFixed(4)).join(","));
  }
  fs.writeFileSync("scripts/results.csv", lines.join("\n") + "\n");
  console.log("Daily retention written to scripts/results.csv");
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes("--epsilon")) {
    printEpsilonSweep();
    return;
  }

  if (args.includes("--theta")) {
    printThetaSweep();
    return;
  }

  const policies: Array<[string, Policy]> = [
    ["v1 utility (interleave)", utilityPolicy],
    ["v1 utility, β=0 ablation", noFatiguePolicy],
    ["Blocked", blockedPolicy],
    ["Random", randomPolicy],
    ["Round-robin", roundRobinPolicy],
  ];

  const results = policies.map(([name, p]) => runSimulation(name, p, DEFAULT_CONFIG));
  printTable(results);
  if (args.includes("--csv")) writeCsv(results);
}

main();
