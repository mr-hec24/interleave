/**
 * §10 — the logging spine.
 *
 * "The log is the asset." Training data, product analytics, and research corpus are
 * one table. The reason the schema is fixed at v1 launch rather than grown as needs
 * appear is that a field not captured in July cannot be recovered in December, and
 * the whole promotion criterion for v2/v3 (§8, §9.5) is *beats the incumbent on
 * time-split log-loss over historical decisions* — which requires that historical
 * decisions were recorded with the model state that produced them, not just their
 * outcomes.
 *
 * That is the discipline this module enforces: every write records the prediction
 * alongside the observation. A log of outcomes alone can tell you what happened but
 * not whether the scheduler was right, and cannot be replayed against a candidate
 * model at all.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Grade } from "./grade";

export type EventType =
  | "review"
  | "session_start"
  | "session_end"
  | "switch"
  | "import"
  | "edge_edit"
  | "prompt_edit";

/** The four utility components (§7), kept separable so a decision can be audited. */
export interface UtilityComponents {
  /** D_i — saturating desirable-difficulty urgency (§4). */
  urgency: number;
  /** F_i — λ_i · Sat(t), the channel fatigue penalty (§5). */
  fatigue: number;
  /** Ready_i — soft readiness (§6). */
  readiness: number;
  /** Intf_i — semantic interference penalty (§7). */
  interference: number;
  /** The weighted total actually compared against the hysteresis margin. */
  utility: number;
}

export interface UtilityEntry extends UtilityComponents {
  skillId: string;
  skillName: string;
}

interface BaseEvent {
  userId: string;
  sessionId?: string | null;
  skillId?: string | null;
  ts?: Date;
}

export interface ReviewEvent extends BaseEvent {
  skillId: string;
  /** Which cue this retrieval was against. Required — see §3.1 of the design doc. */
  promptRef: string;
  /** 1-based within (session, prompt). §9.3's readiness head needs first attempts. */
  attemptIndex: number;
  grade: Grade;
  /** Days since this skill's previous review. */
  deltaT: number | null;
  /** Predicted recall probability at the moment of asking. The other half of the
   *  pair that makes calibration possible; without it the grade is unanchored. */
  rPred: number | null;
  sBefore: number | null;
  sAfter: number;
  difficulty: number;
  /** Seconds from cue shown to grade submitted. Feeds the within-session drift
   *  series that §11 names as a fit target for the fatigue constants. */
  latencySeconds: number;
}

export interface SessionStartEvent extends BaseEvent {
  skillId: string;
  sessionId: string;
  /** Top-k utilities with components — why this skill and not another. */
  uVector: UtilityEntry[];
  satState: number[];
  simContext: number | null;
  embeddingProvider: string;
}

export interface SwitchEvent extends BaseEvent {
  sessionId: string;
  /** The skill being left. */
  fromSkillId: string;
  /** The skill being moved to; null when the learner ends instead of switching. */
  skillId: string | null;
  uVector: UtilityEntry[];
  satState: number[];
  simContext: number | null;
  /** U_{i*} − U_c at the moment of the decision; compare against ε to see whether
   *  the controller fired or the learner overrode it. */
  utilityMargin: number;
  /** False when the learner switched or stopped against the controller's advice.
   *  Recording disagreement is the point: acceptance rate is the trust metric. */
  controllerInitiated: boolean;
}

export interface SessionEndEvent extends BaseEvent {
  sessionId: string;
  skillId: string | null;
  /** Minutes of the whole sitting. Emergent, not configured (§7). */
  sessionDur: number;
  satState: number[];
  /** One-tap 1–5 self-report. Null when the learner skipped it. */
  fatigueReport: number | null;
  /** Per-attempt latency series and the drift statistic derived from it. */
  latencyStats: { attempts: number[]; medianSeconds: number } | null;
  errorDrift: number | null;
}

export interface ImportEvent extends BaseEvent {
  skillsCreated: number;
  promptsCreated: number;
  edgesProposed: number;
  model: string;
}

export interface EdgeEditEvent extends BaseEvent {
  skillId: string;
  prereqSkillId: string;
  action: "confirmed" | "rejected" | "added" | "removed";
  /** Whether the edge originated from the LLM pass. These edits are the ground
   *  truth §11 wants for scoring extracted-prerequisite quality. */
  wasLlmProposed: boolean;
}

export interface PromptEditEvent extends BaseEvent {
  skillId: string;
  promptRef: string;
  action: "added" | "edited" | "archived";
  previousSource: string | null;
}

type Db = SupabaseClient;

const SCHEDULER_VERSION = "v1";

async function insert(db: Db, row: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("events").insert({
    scheduler_version: SCHEDULER_VERSION,
    ...row,
  });
  if (error) {
    // A dropped event is silent data loss in the asset the whole roadmap depends
    // on, so it is surfaced rather than swallowed. Callers decide whether losing
    // the event should also fail the user-visible action.
    throw new Error(`[events] failed to log ${row.event_type}: ${error.message}`);
  }
}

export async function logReview(db: Db, e: ReviewEvent): Promise<void> {
  await insert(db, {
    user_id: e.userId,
    session_id: e.sessionId ?? null,
    ts: (e.ts ?? new Date()).toISOString(),
    event_type: "review",
    skill_id: e.skillId,
    prompt_ref: e.promptRef,
    attempt_index: e.attemptIndex,
    grade: e.grade,
    delta_t: e.deltaT,
    r_pred: e.rPred,
    s_before: e.sBefore,
    s_after: e.sAfter,
    difficulty: e.difficulty,
    latency_stats: { seconds: e.latencySeconds },
  });
}

export async function logSessionStart(db: Db, e: SessionStartEvent): Promise<void> {
  await insert(db, {
    user_id: e.userId,
    session_id: e.sessionId,
    ts: (e.ts ?? new Date()).toISOString(),
    event_type: "session_start",
    skill_id: e.skillId,
    u_vector: e.uVector,
    sat_state: e.satState,
    sim_context: e.simContext,
    embedding_provider: e.embeddingProvider,
  });
}

export async function logSwitch(db: Db, e: SwitchEvent): Promise<void> {
  await insert(db, {
    user_id: e.userId,
    session_id: e.sessionId,
    ts: (e.ts ?? new Date()).toISOString(),
    event_type: "switch",
    skill_id: e.skillId,
    u_vector: e.uVector,
    sat_state: e.satState,
    sim_context: e.simContext,
    meta: {
      from_skill_id: e.fromSkillId,
      utility_margin: e.utilityMargin,
      controller_initiated: e.controllerInitiated,
    },
  });
}

export async function logSessionEnd(db: Db, e: SessionEndEvent): Promise<void> {
  await insert(db, {
    user_id: e.userId,
    session_id: e.sessionId,
    ts: (e.ts ?? new Date()).toISOString(),
    event_type: "session_end",
    skill_id: e.skillId,
    session_dur: e.sessionDur,
    sat_state: e.satState,
    fatigue_report: e.fatigueReport,
    latency_stats: e.latencyStats,
    error_drift: e.errorDrift,
  });
}

export async function logImport(db: Db, e: ImportEvent): Promise<void> {
  await insert(db, {
    user_id: e.userId,
    ts: (e.ts ?? new Date()).toISOString(),
    event_type: "import",
    meta: {
      skills_created: e.skillsCreated,
      prompts_created: e.promptsCreated,
      edges_proposed: e.edgesProposed,
      model: e.model,
    },
  });
}

export async function logEdgeEdit(db: Db, e: EdgeEditEvent): Promise<void> {
  await insert(db, {
    user_id: e.userId,
    ts: (e.ts ?? new Date()).toISOString(),
    event_type: "edge_edit",
    skill_id: e.skillId,
    meta: {
      prereq_skill_id: e.prereqSkillId,
      action: e.action,
      was_llm_proposed: e.wasLlmProposed,
    },
  });
}

export async function logPromptEdit(db: Db, e: PromptEditEvent): Promise<void> {
  await insert(db, {
    user_id: e.userId,
    ts: (e.ts ?? new Date()).toISOString(),
    event_type: "prompt_edit",
    skill_id: e.skillId,
    prompt_ref: e.promptRef,
    meta: { action: e.action, previous_source: e.previousSource },
  });
}

/**
 * Within-session performance drift, from the per-attempt latency series.
 *
 * §11 lists error/latency drift as one of two fit targets for the fatigue constants
 * τ and ρ, which the attention-residue literature does not supply. The statistic is
 * a normalised late-vs-early median ratio: positive means slowing down over the
 * block, which is the signature the leaky-integrator model predicts.
 *
 * Medians rather than means because a single interrupted attempt — the learner put
 * the guitar down to answer the door — otherwise dominates the estimate.
 *
 * Returns null below 4 attempts, where the split halves are too small to mean
 * anything. Reporting a number there would just be noise entering a fit.
 */
export function computeErrorDrift(latenciesSeconds: number[]): number | null {
  if (latenciesSeconds.length < 4) return null;
  const mid = Math.floor(latenciesSeconds.length / 2);
  const early = median(latenciesSeconds.slice(0, mid));
  const late = median(latenciesSeconds.slice(mid));
  if (early <= 0) return null;
  return (late - early) / early;
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
