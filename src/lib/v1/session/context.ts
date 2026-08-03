/**
 * Assembles everything the §7 controller needs for one ranking pass.
 *
 * The controller is pure — it takes state and returns a ranking. This module is the
 * boundary that turns database rows into that state, and it is the only place that
 * knows about both. Keeping it separate is what lets the simulator drive the exact
 * same controller with synthetic state.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { configFromRow, DEFAULT_CONFIG, type SchedulerConfig } from "../config";
import { currentSaturation, ZERO_SATURATION, type ChannelVector } from "../fatigue";
import type { CandidateSkill } from "../controller";
import type { PrereqEdge } from "../readiness";
import { buildSimilarityGraph, type SimilarEdge, type SimilarityGraph } from "../similarity";
import type { RetrievalPrompt } from "../prompts";

export interface SessionContext {
  config: SchedulerConfig;
  skills: CandidateSkill[];
  /** Saturation already decayed forward to `now`. */
  saturation: number[];
  prereqEdges: PrereqEdge[];
  similarityGraph: SimilarityGraph;
  /** Live cue pool per skill id. */
  promptsBySkill: Map<string, RetrievalPrompt[]>;
}

interface SkillRow {
  id: string;
  name: string;
  stability_days: number | string | null;
  difficulty: number | string | null;
  priority_weight: number | string | null;
  channel_loadings: Array<number | string> | null;
  last_reviewed_at: string | null;
}

interface PromptRow {
  id: string;
  skill_id: string;
  text: string;
  source: "llm" | "user" | "migrated";
  last_served_at: string | null;
  times_served: number;
}

/** Postgres `numeric` arrives as a string over PostgREST. See config.ts. */
function num(v: number | string | null | undefined, fallback: number): number {
  if (v === null || v === undefined) return fallback;
  const parsed = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNum(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const parsed = typeof v === "number" ? v : Number.parseFloat(v);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function loadSessionContext(
  db: SupabaseClient,
  userId: string,
  now: Date = new Date()
): Promise<SessionContext> {
  const [configRes, skillsRes, promptsRes, prereqRes, similarRes, satRes] =
    await Promise.all([
      db.from("scheduler_config").select("*").eq("user_id", userId).maybeSingle(),
      db
        .from("skills")
        .select(
          "id, name, stability_days, difficulty, priority_weight, channel_loadings, last_reviewed_at"
        )
        .eq("user_id", userId)
        .is("archived_at", null),
      db
        .from("retrieval_prompts")
        .select("id, skill_id, text, source, last_served_at, times_served")
        .eq("user_id", userId)
        .is("archived_at", null),
      db
        .from("skill_prereq_edges")
        .select("skill_id, prereq_skill_id")
        .eq("user_id", userId)
        .eq("confirmed", true),
      db.from("skill_similar_edges").select("skill_a, skill_b, sim").eq("user_id", userId),
      db
        .from("user_channel_state")
        .select("sat, updated_at")
        .eq("user_id", userId)
        .maybeSingle(),
    ]);

  const config = configFromRow(configRes.data);

  const promptsBySkill = new Map<string, RetrievalPrompt[]>();
  for (const p of (promptsRes.data ?? []) as PromptRow[]) {
    const entry: RetrievalPrompt = {
      id: p.id,
      skillId: p.skill_id,
      text: p.text,
      source: p.source,
      lastServedAt: p.last_served_at ? new Date(p.last_served_at) : null,
      timesServed: p.times_served ?? 0,
    };
    const existing = promptsBySkill.get(p.skill_id);
    if (existing) existing.push(entry);
    else promptsBySkill.set(p.skill_id, [entry]);
  }

  const skills: CandidateSkill[] = ((skillsRes.data ?? []) as SkillRow[]).map((s) => ({
    id: s.id,
    name: s.name,
    stability: nullableNum(s.stability_days),
    difficulty: num(s.difficulty, 5),
    priorityWeight: num(s.priority_weight, 1),
    channelLoadings: (s.channel_loadings ?? [0.25, 0.25, 0.25, 0.25]).map((x) =>
      num(x, 0.25)
    ),
    lastReviewedAt: s.last_reviewed_at ? new Date(s.last_reviewed_at) : null,
    promptPoolSize: promptsBySkill.get(s.id)?.length ?? 0,
  }));

  const prereqEdges: PrereqEdge[] = (prereqRes.data ?? []).map(
    (e: { skill_id: string; prereq_skill_id: string }) => ({
      skillId: e.skill_id,
      prereqSkillId: e.prereq_skill_id,
    })
  );

  const similarEdges: SimilarEdge[] = (similarRes.data ?? []).map(
    (e: { skill_a: string; skill_b: string; sim: number | string }) => ({
      skillA: e.skill_a,
      skillB: e.skill_b,
      sim: num(e.sim, 0),
    })
  );

  // Idle decay is applied here rather than being left to callers: fatigue you slept
  // off and fatigue from ten minutes ago are different states, and a stale reading
  // would suppress exactly the skills the learner is freshest for.
  const persisted: ChannelVector = (satRes.data?.sat ?? ZERO_SATURATION).map(
    (x: number | string) => num(x, 0)
  );
  const persistedAt = satRes.data?.updated_at
    ? new Date(satRes.data.updated_at)
    : now;

  return {
    config,
    skills,
    saturation: currentSaturation(persisted, persistedAt, now, config.fatigue),
    prereqEdges,
    similarityGraph: buildSimilarityGraph(similarEdges),
    promptsBySkill,
  };
}

export { DEFAULT_CONFIG };
