/**
 * §7 — The utility score and switching policy.
 *
 *     U_i(t) = α·D_i(t) − β·F_i(t) + γ·Ready_i(t) − δ·Intf_i(t)
 *
 *     switch from current skill c to i* = argmax U_i   iff   U_{i*} > U_c + ε
 *
 * This is the only module in the system that decides anything. Everything else
 * computes a quantity; this combines them and picks.
 *
 * ## Two exclusions, not penalties
 *
 * Candidates are filtered before the argmax, never scored and then zeroed:
 *
 *   - **Unreachable** (§6): an unmet hard prerequisite. See readiness.ts for why
 *     multiplicative gating inverts once U can go negative.
 *   - **No retrieval cue**: a skill with an empty prompt pool has no gradeable
 *     retrieval, so scheduling it would manufacture an undefined measurement. See
 *     prompts.ts.
 *
 * Both are reported with a reason rather than silently dropped, because a skill
 * vanishing from the rotation with no explanation is indistinguishable from a bug.
 *
 * ## Session length is emergent
 *
 * There is no block-duration parameter in this file, and there must never be one. A
 * block ends when fatigue accumulation and urgency drift have moved the utilities
 * far enough that a rival beats the incumbent by more than ε. That is the entire
 * mechanism. ε is per-user tunable and is the sole granularity control.
 *
 * Hysteresis exists because pure argmax chatters: as F_c rises during practice, U_c
 * falls until a rival overtakes it, and without a margin the system thrashes at the
 * crossover — switching back and forth every few seconds while the two utilities
 * hover around each other.
 */

import type { SchedulerConfig } from "./config";
import type { UtilityComponents, UtilityEntry } from "./events";
import { urgency } from "./urgency";
import { fatiguePenalty, type ChannelVector } from "./fatigue";
import { reachable, softReadiness, unmetPrereqs, type PrereqEdge } from "./readiness";
import { retrievability } from "./memory";
import { interference, interferenceSource } from "./interference";
import type { SimilarityGraph } from "./similarity";
import { similarityTo } from "./similarity";
import type { RecentPractice } from "./interference";

/** Everything the controller needs to know about one candidate skill. */
export interface CandidateSkill {
  id: string;
  name: string;
  stability: number | null;
  difficulty: number;
  /** λ_i — channel loadings, normalised. */
  channelLoadings: ChannelVector;
  /** W_i — user-set importance. */
  priorityWeight: number;
  lastReviewedAt: Date | null;
  /** Live (non-archived) retrieval cues. Zero means not schedulable. */
  promptPoolSize: number;
}

export type ExclusionReason = "no_prompts" | "unreachable";

export interface RankedSkill extends UtilityEntry {
  /** R_i(t), carried through because the audit surface and the log both want it. */
  retrievability: number;
  /** Which recently-practised skill drives the interference penalty, if any. */
  interferenceFrom: { skillId: string; sim: number } | null;
}

export interface ExcludedSkill {
  skillId: string;
  skillName: string;
  reason: ExclusionReason;
  /** For `unreachable`: the prerequisite skill ids still unmet. */
  unmetPrereqs: string[];
}

export interface RankingInput {
  skills: readonly CandidateSkill[];
  now: Date;
  config: SchedulerConfig;
  /** Channel saturation already brought forward to `now` (see fatigue.ts). */
  saturation: ChannelVector;
  prereqEdges: readonly PrereqEdge[];
  similarityGraph: SimilarityGraph;
  recentPractice: readonly RecentPractice[];
}

export interface Ranking {
  ranked: RankedSkill[];
  excluded: ExcludedSkill[];
}

function elapsedDays(lastReviewedAt: Date | null, now: Date): number {
  if (!lastReviewedAt) return 0;
  return Math.max(0, (now.getTime() - lastReviewedAt.getTime()) / 86400000);
}

/** Assembles U from its parts. Kept separate so the weights are auditable in one place. */
export function computeUtility(
  components: Omit<UtilityComponents, "utility">,
  config: SchedulerConfig,
  priorityWeight: number
): number {
  const base =
    config.alpha * components.urgency -
    config.beta * components.fatigue +
    config.gamma * components.readiness -
    config.delta * components.interference;
  // W_i scales the whole score rather than entering as another additive term: a
  // skill the learner marked important should be *more responsive* to becoming due,
  // not permanently offset upward regardless of whether it needs attention.
  return base * priorityWeight;
}

/**
 * Ranks all candidates, returning both the ordering and the reasons for exclusion.
 *
 * The per-component breakdown travels with each result because §10 requires
 * `u_vector` on every switch decision and the trust argument in the design doc
 * requires the reasoning to be visible. One structure serves both, so the numbers on
 * screen and the numbers in the log cannot drift apart.
 */
export function rankSkills(input: RankingInput): Ranking {
  const { skills, now, config, saturation, prereqEdges, similarityGraph, recentPractice } =
    input;

  const stabilities = new Map<string, number | null>(
    skills.map((s) => [s.id, s.stability])
  );

  const ranked: RankedSkill[] = [];
  const excluded: ExcludedSkill[] = [];

  for (const skill of skills) {
    // Exclusion 1 — the measurement invariant. Checked first: without a cue there
    // is nothing to schedule regardless of what the prerequisites say.
    if (skill.promptPoolSize <= 0) {
      excluded.push({
        skillId: skill.id,
        skillName: skill.name,
        reason: "no_prompts",
        unmetPrereqs: [],
      });
      continue;
    }

    // Exclusion 2 — §6's hard mask.
    if (!reachable(skill.id, prereqEdges, stabilities)) {
      excluded.push({
        skillId: skill.id,
        skillName: skill.name,
        reason: "unreachable",
        unmetPrereqs: unmetPrereqs(skill.id, prereqEdges, stabilities),
      });
      continue;
    }

    const r = retrievability(elapsedDays(skill.lastReviewedAt, now), skill.stability);
    const components = {
      urgency: urgency(r, config.theta, config.sigma),
      fatigue: fatiguePenalty(skill.channelLoadings, saturation),
      readiness: softReadiness(skill.id, prereqEdges, stabilities),
      interference: interference(
        skill.id,
        similarityGraph,
        recentPractice,
        config.interferenceWindow
      ),
    };

    ranked.push({
      skillId: skill.id,
      skillName: skill.name,
      ...components,
      utility: computeUtility(components, config, skill.priorityWeight),
      retrievability: r,
      interferenceFrom: interferenceSource(
        skill.id,
        similarityGraph,
        recentPractice,
        config.interferenceWindow
      ),
    });
  }

  // Descending utility, with a deterministic tie-break so an unchanged state always
  // produces the same recommendation. A ranking that reshuffles on equal scores
  // would look to the learner like the scheduler changing its mind for no reason.
  ranked.sort((a, b) => {
    if (b.utility !== a.utility) return b.utility - a.utility;
    return a.skillId < b.skillId ? -1 : 1;
  });

  return { ranked, excluded };
}

export interface SwitchDecision {
  /** True when the margin condition fired. */
  shouldSwitch: boolean;
  /** The skill to move to, when switching. */
  target: RankedSkill | null;
  /** U_{i*} − U_c. Logged so an override can be told apart from an agreement. */
  margin: number;
  /** The margin needed. Logged alongside so the log is self-describing when ε changes. */
  epsilon: number;
  incumbent: RankedSkill | null;
}

/**
 * The switching policy: move from `currentSkillId` to the top-ranked rival only if
 * it beats the incumbent by more than ε.
 *
 * With no current skill (session start) the top candidate is chosen outright —
 * there is no incumbent to be sticky about.
 */
export function decideSwitch(
  ranking: Ranking,
  currentSkillId: string | null,
  config: SchedulerConfig
): SwitchDecision {
  const { ranked } = ranking;
  if (ranked.length === 0) {
    return {
      shouldSwitch: false,
      target: null,
      margin: 0,
      epsilon: config.epsilon,
      incumbent: null,
    };
  }

  if (currentSkillId === null) {
    return {
      shouldSwitch: true,
      target: ranked[0],
      margin: Number.POSITIVE_INFINITY,
      epsilon: config.epsilon,
      incumbent: null,
    };
  }

  const incumbent = ranked.find((r) => r.skillId === currentSkillId) ?? null;

  // The incumbent left the candidate set mid-block — its cue pool was emptied, or a
  // prerequisite edge was added that now blocks it. Continuing to practise a skill
  // the scheduler can no longer score would put ungradeable events in the log, so
  // this moves immediately rather than waiting for a margin.
  if (!incumbent) {
    return {
      shouldSwitch: true,
      target: ranked[0],
      margin: Number.POSITIVE_INFINITY,
      epsilon: config.epsilon,
      incumbent: null,
    };
  }

  const challenger = ranked.find((r) => r.skillId !== currentSkillId) ?? null;
  if (!challenger) {
    return {
      shouldSwitch: false,
      target: null,
      margin: 0,
      epsilon: config.epsilon,
      incumbent,
    };
  }

  const margin = challenger.utility - incumbent.utility;
  return {
    shouldSwitch: margin > config.epsilon,
    target: margin > config.epsilon ? challenger : null,
    margin,
    epsilon: config.epsilon,
    incumbent,
  };
}

/**
 * `sim_context` for the event log (§10): how semantically close the skill being
 * started is to the block that preceded it.
 *
 * This is the field that recovers, after the fact, which Brunmair & Richter
 * similarity regime the scheduler was operating in — the difference between "the
 * interference term did nothing" and "there was nothing for it to do".
 */
export function simContextFor(
  similarityGraph: SimilarityGraph,
  skillId: string,
  previousSkillId: string | null
): number {
  return similarityTo(similarityGraph, skillId, previousSkillId);
}

/** Top-k entries for `u_vector`, trimmed of the fields the log does not need. */
export function toUVector(ranked: readonly RankedSkill[], k = 5): UtilityEntry[] {
  return ranked.slice(0, k).map((r) => ({
    skillId: r.skillId,
    skillName: r.skillName,
    urgency: r.urgency,
    fatigue: r.fatigue,
    readiness: r.readiness,
    interference: r.interference,
    utility: r.utility,
  }));
}
