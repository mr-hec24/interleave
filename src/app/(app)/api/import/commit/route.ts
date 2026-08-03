import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logImport, logEdgeEdit } from "@/lib/v1/events";
import { IMPORT_MODEL } from "@/lib/v1/import/extract";
import { CHANNELS, normaliseLoading } from "@/lib/v1/fatigue";
import { findCycle, type PrereqEdge } from "@/lib/v1/readiness";

/**
 * Commits the parts of an import proposal the learner accepted.
 *
 * Everything here is what they kept, not what was offered — which is the point.
 * §11 wants "link-head AUC vs. user edge edits as ground truth", so the accept /
 * reject decision on each proposed edge is the label, and it only exists if the
 * commit step records both sides.
 */

interface CommitSkill {
  name: string;
  description: string;
  channelLoadings: number[];
  retrievalCues: string[];
  /** The extraction-local key, used to resolve edges below. */
  key: string;
}

interface CommitEdge {
  skillKey: string;
  prereqKey: string;
  /** False when the learner rejected a proposed edge — logged, not inserted. */
  accepted: boolean;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let body: { skills?: CommitSkill[]; edges?: CommitEdge[]; topicId?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const skills = (body.skills ?? []).filter((s) => s?.name?.trim());
  if (skills.length === 0) {
    return NextResponse.json({ error: "No skills to import." }, { status: 400 });
  }

  // A skill with no cue is not schedulable (see prompts.ts). Rather than write one
  // that silently never appears in the rotation, reject it here with a reason the
  // UI can act on.
  const cueless = skills.filter((s) => (s.retrievalCues ?? []).length === 0);
  if (cueless.length > 0) {
    return NextResponse.json(
      {
        error:
          `These skills have no retrieval cue and could not be practised: ` +
          `${cueless.map((s) => s.name).join(", ")}. Add a cue to each, or drop them.`,
      },
      { status: 400 }
    );
  }

  const keyToSkillId = new Map<string, string>();
  let promptsCreated = 0;

  for (const skill of skills) {
    const { data: created, error: skillError } = await supabase
      .from("skills")
      .insert({
        user_id: user.id,
        name: skill.name.trim(),
        description: skill.description?.trim() || null,
        topic_id: body.topicId ?? null,
        channel_loadings: normaliseLoading(
          skill.channelLoadings ?? CHANNELS.map(() => 0.25)
        ),
      })
      .select("id")
      .single();

    if (skillError || !created) {
      console.error("[import/commit] skill insert failed:", skillError?.message);
      return NextResponse.json(
        { error: `Could not create "${skill.name}": ${skillError?.message}` },
        { status: 500 }
      );
    }
    keyToSkillId.set(skill.key, created.id);

    const cues = skill.retrievalCues
      .map((c) => c?.trim())
      .filter((c): c is string => Boolean(c))
      .map((text) => ({
        user_id: user.id,
        skill_id: created.id,
        text,
        source: "llm" as const,
      }));

    const { error: cueError } = await supabase.from("retrieval_prompts").insert(cues);
    if (cueError) {
      console.error("[import/commit] cue insert failed:", cueError.message);
      return NextResponse.json(
        { error: `Could not save cues for "${skill.name}": ${cueError.message}` },
        { status: 500 }
      );
    }
    promptsCreated += cues.length;
  }

  // Re-validate acyclicity against the resolved ids. The extraction already checked
  // its own proposal, but the learner may have accepted a subset, reordered, or
  // edited it since — and the database trigger rejects a cycle one row at a time,
  // which would leave a partial graph behind.
  const accepted = (body.edges ?? []).filter((e) => e.accepted);
  const resolved: PrereqEdge[] = [];
  for (const edge of accepted) {
    const skillId = keyToSkillId.get(edge.skillKey);
    const prereqSkillId = keyToSkillId.get(edge.prereqKey);
    if (!skillId || !prereqSkillId) continue;
    resolved.push({ skillId, prereqSkillId });
  }

  const { acyclic, cycle } = findCycle(resolved);
  if (!acyclic) {
    return NextResponse.json(
      {
        error:
          "The accepted prerequisites form a circular dependency, so none were " +
          `applied. The skills themselves were created. Cycle: ${cycle!.join(" → ")}`,
      },
      { status: 400 }
    );
  }

  if (resolved.length > 0) {
    const { error: edgeError } = await supabase.from("skill_prereq_edges").insert(
      resolved.map((e) => ({
        user_id: user.id,
        skill_id: e.skillId,
        prereq_skill_id: e.prereqSkillId,
        source: "llm",
        // Accepted at the review step, so it gates scheduling immediately.
        confirmed: true,
      }))
    );
    if (edgeError) {
      console.error("[import/commit] edge insert failed:", edgeError.message);
      return NextResponse.json(
        { error: `Skills were created, but prerequisites failed: ${edgeError.message}` },
        { status: 500 }
      );
    }
  }

  try {
    await logImport(supabase, {
      userId: user.id,
      skillsCreated: skills.length,
      promptsCreated,
      edgesProposed: (body.edges ?? []).length,
      model: IMPORT_MODEL,
    });

    // Both decisions, not just the accepts. A rejected edge is as informative a
    // label as an accepted one for scoring extraction quality (§11), and it is only
    // recoverable if written down at the moment the learner made the call.
    for (const edge of body.edges ?? []) {
      const skillId = keyToSkillId.get(edge.skillKey);
      const prereqSkillId = keyToSkillId.get(edge.prereqKey);
      if (!skillId || !prereqSkillId) continue;
      await logEdgeEdit(supabase, {
        userId: user.id,
        skillId,
        prereqSkillId,
        action: edge.accepted ? "confirmed" : "rejected",
        wasLlmProposed: true,
      });
    }
  } catch (error) {
    // The graph is written and usable; only the log entry failed. Surface it rather
    // than swallowing it — a silent gap in the event table is a gap in the asset
    // every later model trains on.
    console.error("[import/commit] event logging failed:", error);
    return NextResponse.json({
      skillsCreated: skills.length,
      promptsCreated,
      edgesCreated: resolved.length,
      warning:
        "Your skills were imported, but this import was not recorded in the event log.",
    });
  }

  return NextResponse.json({
    skillsCreated: skills.length,
    promptsCreated,
    edgesCreated: resolved.length,
  });
}
