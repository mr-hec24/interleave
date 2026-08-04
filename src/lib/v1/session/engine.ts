/**
 * The practice block, as a state machine.
 *
 * §7: "Session length is emergent. No block-duration parameter exists: a block lasts
 * however long it takes fatigue accumulation plus urgency drift to overcome ε."
 *
 * That sentence has a concrete consequence for the UI. There is no countdown, no
 * configured length, and nothing that ends a block on a clock. A block is a pass
 * over one skill's cue pool: each cue is served once, graded, and logged. When the
 * pool is covered the skill's state advances (see below), the controller re-ranks,
 * and the switch prompt appears when — and only when — a rival beats the incumbent
 * by more than ε. A large ε keeps you on the same skill for another pass.
 *
 * Coverage is the checkpoint, not the decision. See `isBlockComplete` for why the
 * utility comparison alone cannot terminate a block, and why this is a
 * measurement-completeness condition rather than the block-duration parameter §7
 * rules out.
 *
 * Kept as a pure module so the transition rules are testable without mounting a
 * component and without a database.
 *
 * ## Attempts measure; blocks update
 *
 * The one design decision here that the spec does not settle, because the spec has
 * no concept of an attempt. Each graded attempt is recorded individually — its own
 * cue, latency, and grade, which is the item-response data §11 needs. But the
 * *skill's* memory state advances **once per block**, aggregating the block's
 * grades, rather than once per attempt.
 *
 * The alternative was tried first and does not work. Updating per attempt sets
 * `last_reviewed_at` to now and drives R to ~1 immediately, so urgency collapses
 * from ~0.49 to ~0.0001 after a single retrieval. A rival then leads by ~0.49 —
 * far past any sensible ε — and **every block is exactly one attempt**. That has
 * two bad consequences: the learner is bounced between skills after every single
 * cue, and β·F becomes inert, since no block ever lasts long enough for fatigue to
 * accumulate. §7 describes a block ending when "fatigue accumulation plus urgency
 * drift" overcome ε; per-attempt updates make urgency drift so violent that fatigue
 * never gets a vote.
 *
 * Per-block updating is also the more honest reading of the measurement layer.
 * Retrieving one cue is evidence about *that item*; treating it as a full review of
 * the whole skill overstates what was observed. Aggregating the block is what
 * "pooling items under a skill node" actually means.
 *
 * The aggregate is the block's **worst** grade — the same reasoning as `min` in
 * §6's soft readiness. A skill where one cue came back cleanly and another didn't
 * is not a skill that was recalled; the failure is the informative part. This
 * discards information deliberately, and the per-attempt rows are logged precisely
 * so a later model can do something better with them.
 */

import type { Grade } from "../grade";
import { applyReview, retrievability, type MemoryState } from "../memory";
import { chargeAfterSession, type ChannelVector } from "../fatigue";
import {
  rankSkills,
  decideSwitch,
  type CandidateSkill,
  type Ranking,
  type SwitchDecision,
} from "../controller";
import { selectPrompt, type RetrievalPrompt } from "../prompts";
import type { SchedulerConfig } from "../config";
import type { PrereqEdge } from "../readiness";
import type { SimilarityGraph } from "../similarity";
import type { RecentPractice } from "../interference";

/** One graded retrieval against one cue — the atomic unit (§3.1 of the design doc). */
export interface Attempt {
  skillId: string;
  promptId: string;
  attemptIndex: number;
  grade: Grade;
  /** Cue shown → grade submitted. Feeds the within-block drift series (§5). */
  latencySeconds: number;
  rPred: number;
  sBefore: number | null;
  sAfter: number;
  difficulty: number;
  deltaT: number | null;
  at: Date;
}

export interface SessionState {
  sessionId: string;
  startedAt: Date;
  /** Mutable copies of the candidate set — advanced in place as attempts land. */
  skills: CandidateSkill[];
  saturation: number[];
  promptsBySkill: Map<string, RetrievalPrompt[]>;
  currentSkillId: string | null;
  /** Cue currently on screen, if any. */
  currentPrompt: RetrievalPrompt | null;
  /** When the current cue was shown — the start of the latency measurement. */
  promptShownAt: Date | null;
  attempts: Attempt[];
  /** Skills practised this session, most recent first, for the interference window. */
  recentPractice: RecentPractice[];
  /** The block before the current one, for `sim_context` on the next start. */
  previousSkillId: string | null;
  /** Attempt counter per prompt within this session (§9.3 needs first attempts). */
  attemptCounts: Map<string, number>;
  /** Cues served in the CURRENT block — drives isBlockComplete. */
  servedThisBlock: Set<string>;
  /** Attempts already folded into a finished block, so a re-entered skill's
   *  earlier block is not aggregated twice. */
  settledAttemptIds: Set<string>;
}

export interface EngineDeps {
  config: SchedulerConfig;
  prereqEdges: PrereqEdge[];
  similarityGraph: SimilarityGraph;
  /** Injected for determinism in tests and simulation. */
  rand?: () => number;
  now?: () => Date;
}

export function rank(state: SessionState, deps: EngineDeps, at: Date): Ranking {
  return rankSkills({
    skills: state.skills,
    now: at,
    config: deps.config,
    saturation: state.saturation,
    prereqEdges: deps.prereqEdges,
    similarityGraph: deps.similarityGraph,
    recentPractice: state.recentPractice,
  });
}

/**
 * Serves the next cue for the current skill, preferring ones not yet seen in this
 * block so a block covers the pool rather than resampling it.
 *
 * Returns null when the skill's pool is empty, which the caller must treat as "this
 * skill is no longer practisable" rather than silently continuing.
 */
export function serveNextPrompt(
  state: SessionState,
  deps: EngineDeps,
  at: Date
): RetrievalPrompt | null {
  if (!state.currentSkillId) return null;
  const pool = state.promptsBySkill.get(state.currentSkillId) ?? [];
  const unseen = pool.filter((p) => !state.servedThisBlock.has(p.id));
  const chosen = selectPrompt(unseen.length > 0 ? unseen : pool, deps.rand);
  if (!chosen) return null;
  state.currentPrompt = chosen;
  state.promptShownAt = at;
  return chosen;
}

/**
 * Has this block covered the skill's cue pool?
 *
 * **This is what ends a block, and it has to be.** The utility comparison on its own
 * cannot do it, for two reasons that only show up with realistic data:
 *
 *   - Every skill created by hand or carried over from before v1 has uniform channel
 *     loadings, so `F_i` is identical across skills and `−β·F` cancels out of every
 *     pairwise comparison. Fatigue cannot break a tie it applies equally to.
 *   - Because a block deliberately does not advance the skill (see the module note),
 *     the incumbent's `last_reviewed_at` stays frozen while the clock runs — so its
 *     `R` keeps decaying, its urgency *rises*, and staying looks better the longer
 *     you stay.
 *
 * Together those made the block unterminating: the learner could cycle the same
 * cues indefinitely and never be offered a switch.
 *
 * Pool coverage is the honest terminator, and it is not a smuggled-in block-duration
 * parameter. §7 rules out a *clock*; this is a measurement-completeness condition —
 * the block ends when every cue has been sampled once, which is exactly when the
 * aggregate becomes a fair summary of the skill. ε still decides what happens next:
 * after the update, the controller re-ranks, and a large ε keeps you on the same
 * skill for another pass while a small one moves you on. Session length stays
 * emergent; it now has a defined checkpoint at which to emerge.
 */
export function isBlockComplete(state: SessionState): boolean {
  if (!state.currentSkillId) return false;
  const pool = state.promptsBySkill.get(state.currentSkillId) ?? [];
  if (pool.length === 0) return true;
  return pool.every((p) => state.servedThisBlock.has(p.id));
}

/**
 * Records a graded attempt and advances every piece of state that depends on it.
 *
 * The ordering matters and is deliberate:
 *   1. R is computed from the PRE-review state, so the prediction logged alongside
 *      the outcome is the one the scheduler actually made.
 *   2. Memory updates.
 *   3. Fatigue charges for the elapsed attempt — per attempt rather than once at the
 *      end, because the closed form is composable and this keeps the utility
 *      re-ranking honest between attempts.
 *   4. The recency window shifts, so interference reflects what was just practised.
 */
export function recordAttempt(
  state: SessionState,
  deps: EngineDeps,
  grade: Grade,
  at: Date
): Attempt {
  const skill = state.skills.find((s) => s.id === state.currentSkillId);
  const prompt = state.currentPrompt;
  if (!skill || !prompt || !state.promptShownAt) {
    throw new Error("recordAttempt called with no cue on screen");
  }

  const latencySeconds = Math.max(
    0,
    (at.getTime() - state.promptShownAt.getTime()) / 1000
  );

  const deltaT = skill.lastReviewedAt
    ? (at.getTime() - skill.lastReviewedAt.getTime()) / 86400000
    : null;

  // The prediction is made against the skill's state as it stood when the block
  // began — unchanged by earlier attempts in this block, because the skill does not
  // advance until the block ends. That is what makes every attempt in a block a
  // comparable observation at the same predicted R.
  const rPred = retrievability(deltaT ?? 0, skill.stability);

  // Projected post-block state, for the event row only. The skill itself is not
  // touched here; `finishBlock` applies the aggregate.
  const before: MemoryState = {
    stability: skill.stability,
    difficulty: skill.difficulty,
  };
  const { next } = applyReview(before, deltaT ?? 0, grade);

  // Fatigue charges for the time this attempt took. Composability of the closed
  // form (see fatigue.ts) is what makes per-attempt charging equivalent to one
  // charge over the whole block — so how often the controller samples cannot
  // change how tired the learner is measured to be.
  state.saturation = chargeAfterSession(
    state.saturation as ChannelVector,
    skill.channelLoadings,
    latencySeconds / 60,
    deps.config.fatigue
  );

  prompt.lastServedAt = at;
  prompt.timesServed += 1;

  state.servedThisBlock.add(prompt.id);

  const attemptIndex = (state.attemptCounts.get(prompt.id) ?? 0) + 1;
  state.attemptCounts.set(prompt.id, attemptIndex);

  const attempt: Attempt = {
    skillId: skill.id,
    promptId: prompt.id,
    attemptIndex,
    grade,
    latencySeconds,
    rPred,
    sBefore: before.stability,
    sAfter: next.stability!,
    difficulty: next.difficulty,
    deltaT,
    at,
  };
  state.attempts.push(attempt);

  // Everything already in the window ages by one block; the just-practised skill
  // enters at distance 1.
  state.recentPractice = [
    { skillId: skill.id, blocksAgo: 1 },
    ...state.recentPractice
      .filter((r) => r.skillId !== skill.id)
      .map((r) => ({ ...r, blocksAgo: r.blocksAgo + 1 })),
  ];

  state.currentPrompt = null;
  state.promptShownAt = null;
  return attempt;
}

/** Asks the controller whether the block should end. The only thing that ends one. */
export function evaluateSwitch(
  state: SessionState,
  deps: EngineDeps,
  at: Date
): SwitchDecision {
  return decideSwitch(rank(state, deps, at), state.currentSkillId, deps.config);
}

export interface BlockOutcome {
  skillId: string;
  /** Worst grade in the block — see the module note on aggregation. */
  aggregateGrade: Grade;
  attempts: Attempt[];
  sBefore: number | null;
  sAfter: number;
  difficulty: number;
  reviewedAt: Date;
}

const GRADE_ORDER: Grade[] = ["again", "hard", "good", "easy"];

/**
 * Closes the current block and applies its aggregate to the skill.
 *
 * Returns null when the block recorded no attempts — a learner who opened a skill
 * and switched away without answering anything has produced no observation, and
 * writing a review event for that would be inventing data.
 */
export function finishBlock(
  state: SessionState,
  deps: EngineDeps,
  at: Date
): BlockOutcome | null {
  const skillId = state.currentSkillId;
  if (!skillId) return null;

  const attempts = state.attempts.filter(
    (a) => a.skillId === skillId && !state.settledAttemptIds.has(a.promptId + a.attemptIndex)
  );
  if (attempts.length === 0) return null;
  for (const a of attempts) state.settledAttemptIds.add(a.promptId + a.attemptIndex);

  const skill = state.skills.find((s) => s.id === skillId);
  if (!skill) return null;

  const aggregateGrade = attempts
    .map((a) => a.grade)
    .reduce((worst, g) =>
      GRADE_ORDER.indexOf(g) < GRADE_ORDER.indexOf(worst) ? g : worst
    );

  const deltaT = skill.lastReviewedAt
    ? (at.getTime() - skill.lastReviewedAt.getTime()) / 86400000
    : 0;
  const before: MemoryState = { stability: skill.stability, difficulty: skill.difficulty };
  const { next } = applyReview(before, deltaT, aggregateGrade);

  skill.stability = next.stability;
  skill.difficulty = next.difficulty;
  skill.lastReviewedAt = at;

  // Staying on this skill begins a fresh pass over the pool rather than resuming a
  // block that has already been settled and aggregated.
  state.servedThisBlock.clear();

  void deps;
  return {
    skillId,
    aggregateGrade,
    attempts,
    sBefore: before.stability,
    sAfter: next.stability!,
    difficulty: next.difficulty,
    reviewedAt: at,
  };
}

export function moveTo(state: SessionState, skillId: string, at: Date): void {
  state.previousSkillId = state.currentSkillId;
  state.currentSkillId = skillId;
  state.currentPrompt = null;
  state.promptShownAt = null;
  // A new block starts with nothing covered — including when re-entering a skill
  // practised earlier in the session.
  state.servedThisBlock.clear();
  void at;
}

export function createSessionState(
  sessionId: string,
  skills: CandidateSkill[],
  saturation: number[],
  promptsBySkill: Map<string, RetrievalPrompt[]>,
  startedAt: Date
): SessionState {
  return {
    sessionId,
    startedAt,
    // Deep-ish copies: the engine mutates these as attempts land, and the caller's
    // context object should stay a clean snapshot of what the server sent.
    skills: skills.map((s) => ({ ...s })),
    saturation: [...saturation],
    promptsBySkill: new Map(
      [...promptsBySkill].map(([k, v]) => [k, v.map((p) => ({ ...p }))])
    ),
    currentSkillId: null,
    currentPrompt: null,
    promptShownAt: null,
    servedThisBlock: new Set(),
    attempts: [],
    recentPractice: [],
    previousSkillId: null,
    attemptCounts: new Map(),
    settledAttemptIds: new Set(),
  };
}

/** Minutes elapsed since the block began. Displayed, never used as a terminator. */
export function elapsedMinutes(state: SessionState, at: Date): number {
  return (at.getTime() - state.startedAt.getTime()) / 60000;
}
