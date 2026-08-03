/**
 * §8 — the import pass.
 *
 * One Claude call over the learner's own material produces the whole v1 node set:
 * skills, their retrieval cues, the prerequisite DAG, and initial channel loadings.
 * This is what makes v1's cold start "perfect by construction" (§8) — a brand-new
 * graph is fully populated before a single review happens.
 *
 * ## What the model does and does not decide
 *
 * It proposes structure. It does not schedule: every quantity it emits is an
 * initialization that the closed-form loop then owns and updates. That boundary is
 * the same one `docs/research-synthesis.md` §5 draws — the trust layer (language)
 * stays separate from the decision layer (arithmetic), so the scheduler remains
 * reproducible and the model cannot silently change what gets recommended.
 *
 * Two things it proposes are explicitly *not* applied on its say-so:
 *
 *   - **Prerequisite edges.** §2 calls LLM-extracted prereqs "noisy by construction"
 *     and §9.3 gives v3 a link-prediction head specifically to prune them. Until
 *     that head exists, the learner is the only cleaner, so edges land unconfirmed
 *     and do not gate scheduling until accepted. Each accept/reject is logged —
 *     §11 wants exactly those edits as ground truth for scoring extraction quality.
 *   - **Retrieval cues.** Seeded from the learner's material, fully editable. Cue
 *     quality is bounded by what was fed in, which is why they are presented rather
 *     than assumed.
 *
 * ## Garbage in, garbage out — stated rather than hidden
 *
 * A syllabus that is vague produces vague cues, and a vague cue produces an
 * ungradeable retrieval, which is the exact failure the measurement layer exists to
 * prevent. The extraction cannot fix thin source material; the UI's job is to make
 * that visible instead of presenting the output as authoritative.
 */

import Anthropic from "@anthropic-ai/sdk";
import { CHANNELS, normaliseLoading } from "../fatigue";
import { findCycle, type PrereqEdge } from "../readiness";

export const IMPORT_MODEL = "claude-opus-5";

export interface ExtractedSkill {
  /** Stable slug used to reference this skill in the edge list. */
  key: string;
  name: string;
  description: string;
  /** λ_i in CHANNELS order, normalised to the simplex. */
  channelLoadings: number[];
  /** 3–5 retrieval cues. */
  retrievalCues: string[];
}

export interface ExtractedEdge {
  skillKey: string;
  prereqKey: string;
  /** Why the model thinks this is a hard dependency — shown at confirmation time. */
  rationale: string;
}

export interface ExtractionResult {
  skills: ExtractedSkill[];
  edges: ExtractedEdge[];
  /** Edges dropped because they would have closed a cycle, with the cycle path. */
  rejectedEdges: Array<{ edge: ExtractedEdge; reason: string }>;
}

/**
 * Response schema. Constrained per the structured-outputs limitations: every object
 * carries `additionalProperties: false` and a complete `required` list, and no
 * numeric or length bounds are used (they are unsupported and would 400).
 *
 * Ranges that cannot be expressed in the schema — 3–5 cues, loadings in [0,1] — are
 * stated in the prompt and enforced in code below. The schema guarantees shape; it
 * cannot guarantee sense.
 */
const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    skills: {
      type: "array",
      items: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description:
              "Short lowercase slug, unique within this response. Used to reference this skill in `prerequisites`.",
          },
          name: {
            type: "string",
            description:
              "The skill name. Narrow enough that one recall rating describes one thing: 'Blues scale in A', not 'Guitar'.",
          },
          description: {
            type: "string",
            description: "One or two sentences on what this skill covers.",
          },
          channel_loadings: {
            type: "object",
            description:
              "How heavily practising this skill loads each cognitive channel. Relative weights; they are normalised afterwards.",
            properties: {
              logical: { type: "number" },
              verbal: { type: "number" },
              visual: { type: "number" },
              motor: { type: "number" },
            },
            required: ["logical", "verbal", "visual", "motor"],
            additionalProperties: false,
          },
          retrieval_cues: {
            type: "array",
            description:
              "3 to 5 retrieval cues. A cue prompts recall from memory; it is not an exercise to be completed in an app.",
            items: { type: "string" },
          },
        },
        required: ["key", "name", "description", "channel_loadings", "retrieval_cues"],
        additionalProperties: false,
      },
    },
    prerequisites: {
      type: "array",
      description:
        "Hard dependencies only. Omit rather than guess — every edge here has to be reviewed by a person.",
      items: {
        type: "object",
        properties: {
          skill_key: { type: "string", description: "The dependent skill's key." },
          prereq_key: {
            type: "string",
            description: "The key of the skill that must come first.",
          },
          rationale: {
            type: "string",
            description:
              "One sentence on why the dependent skill is not attemptable without this one.",
          },
        },
        required: ["skill_key", "prereq_key", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: ["skills", "prerequisites"],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You turn a learner's own study material into a practice graph for a spaced-repetition scheduler.

You are proposing structure, not scheduling anything. Every number you emit is an initial value that a deterministic scheduler then owns and updates from real performance data. Nothing you output is final, and all of it is reviewed by the learner before it takes effect.

## Skills

A skill is the unit that carries one forgetting curve, so it must be narrow enough that a single "how well did that come back?" rating describes one thing.

- Good: "Passé composé with être", "Blues scale in A", "Deriving the chain rule"
- Too broad: "French", "Guitar", "Calculus" — these blend several curves into one meaningless number

Prefer more, narrower skills over fewer, broader ones. Only create skills the source material actually supports; do not invent a curriculum it does not contain.

## Retrieval cues

Each skill gets 3 to 5 cues. A cue prompts the learner to retrieve something from memory and then rate how it went. They perform it in the real world — on their instrument, in their editor, on paper. Nothing is typed into or graded by the app.

The test of a good cue: after attempting it, can the learner answer yes or no to "did I recall that?"

- Good: "Play the F major scale from memory, both hands, without looking at the sheet."
- Good: "Explain what a closure captures and when that becomes a problem."
- Good: "Conjugate 'venir' in the passé composé for all six persons."
- Weak: "Practise scales." — nothing specific was retrieved
- Wrong: "Which of these is a closure? (a)... (b)..." — that is a quiz question, not a cue
- Wrong: "Read chapter 4 again." — that is restudy, not retrieval

Draw cues from the specifics in the material. If the material is too vague to support a specific cue, write fewer cues rather than padding with generic ones.

## Channel loadings

Rate how heavily practising each skill loads four cognitive channels, as relative weights:

- logical — reasoning, mathematics, debugging, analysis
- verbal — language, vocabulary, reading, writing
- visual — spatial reasoning, diagrams, imagery, layout
- motor — physical execution: an instrument, handwriting, technique

Most skills load more than one. A guitar scale is motor-dominant with a visual component; reading comprehension is verbal-dominant; a proof is logical-dominant. The scheduler uses these to avoid stacking two skills that tire the same channel, so relative proportions matter and absolute magnitude does not.

## Prerequisites

Only genuine hard dependencies: the dependent skill cannot be meaningfully attempted before the prerequisite is in place. "Related to" and "usually taught after" are not prerequisites.

Be conservative. Every edge you propose is reviewed by a person, and a false edge locks a skill the learner could actually have practised. When unsure, omit it. Never propose a cycle.`;

export interface ExtractionInput {
  /** Raw material — syllabus, notes, a chapter list, a description of goals. */
  material: string;
  /** Optional topic name for context. */
  topicName?: string;
}

/**
 * Runs the import pass.
 *
 * Streamed because a large syllabus can produce many skills with several cues each,
 * and a non-streaming request at this output size risks an SDK HTTP timeout.
 */
export async function extractSkillGraph(
  client: Anthropic,
  input: ExtractionInput
): Promise<ExtractionResult> {
  const context = input.topicName
    ? `The learner filed this material under "${input.topicName}".\n\n`
    : "";

  const stream = client.messages.stream({
    model: IMPORT_MODEL,
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: EXTRACTION_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `${context}Here is the material:\n\n<material>\n${input.material}\n</material>`,
      },
    ],
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === "max_tokens") {
    throw new Error(
      "The import produced more than one pass can hold. Split the material into " +
        "smaller pieces — one topic at a time — and import them separately."
    );
  }
  if (message.stop_reason === "refusal") {
    throw new Error("The import request was declined. Try rephrasing the material.");
  }

  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("The import returned no content.");
  }

  return normaliseExtraction(JSON.parse(text.text));
}

/**
 * Cues for a single hand-created skill.
 *
 * The manual "add a skill" path routes through here so there is no way to create a
 * schedulable skill without a cue — otherwise the measurement invariant would hold
 * for imported skills and quietly not for typed-in ones, and the log would carry two
 * populations that look identical but were not measured the same way.
 *
 * Suggestions only. The learner edits or replaces them, and a skill's own cues are
 * often better than anything inferable from a one-line name.
 */
export async function suggestCues(
  client: Anthropic,
  skill: { name: string; description?: string | null }
): Promise<string[]> {
  const message = await client.messages.create({
    model: IMPORT_MODEL,
    max_tokens: 2000,
    thinking: { type: "adaptive" },
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: {
            retrieval_cues: { type: "array", items: { type: "string" } },
          },
          required: ["retrieval_cues"],
          additionalProperties: false,
        },
      },
    },
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content:
          `Write 3 to 5 retrieval cues for this one skill. Return only the cues.\n\n` +
          `Skill: ${skill.name}\n` +
          (skill.description?.trim()
            ? `Notes: ${skill.description.trim()}\n`
            : "") +
          `\nIf the name is too vague to support specific cues, write fewer rather ` +
          `than padding with generic ones.`,
      },
    ],
  });

  if (message.stop_reason === "refusal") return [];
  const text = message.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return [];

  const parsed = JSON.parse(text.text) as { retrieval_cues?: string[] };
  return (parsed.retrieval_cues ?? [])
    .map((c) => (c ?? "").trim())
    .filter((c) => c.length > 0)
    .slice(0, 5);
}

interface RawExtraction {
  skills: Array<{
    key: string;
    name: string;
    description: string;
    channel_loadings: Record<string, number>;
    retrieval_cues: string[];
  }>;
  prerequisites: Array<{ skill_key: string; prereq_key: string; rationale: string }>;
}

/**
 * Validates and repairs the extraction.
 *
 * The schema guarantees shape but not sense, and the parts that matter most here —
 * cue count, loading magnitudes, edge acyclicity — are exactly the parts JSON Schema
 * cannot express. Everything is repaired rather than rejected where a repair is
 * unambiguous, because failing a whole import over one malformed edge would be a
 * worse outcome than dropping the edge.
 *
 * Exported for testing.
 */
export function normaliseExtraction(raw: RawExtraction): ExtractionResult {
  const seenKeys = new Set<string>();
  const skills: ExtractedSkill[] = [];

  for (const s of raw.skills ?? []) {
    const key = (s.key ?? "").trim();
    const name = (s.name ?? "").trim();
    // A skill with no key cannot be referenced by an edge, and one with no name
    // cannot be shown to the learner. Either way there is nothing to repair.
    if (!key || !name || seenKeys.has(key)) continue;
    seenKeys.add(key);

    const cues = (s.retrieval_cues ?? [])
      .map((c) => (c ?? "").trim())
      .filter((c) => c.length > 0)
      // Cap at 5 per the prompt. Under-delivery is left alone: fewer cues drawn
      // from thin material is the honest outcome, and the UI surfaces it.
      .slice(0, 5);

    skills.push({
      key,
      name,
      description: (s.description ?? "").trim(),
      channelLoadings: normaliseLoading(
        CHANNELS.map((c) => s.channel_loadings?.[c] ?? 0)
      ),
      retrievalCues: cues,
    });
  }

  const validKeys = new Set(skills.map((s) => s.key));
  const edges: ExtractedEdge[] = [];
  const rejectedEdges: ExtractionResult["rejectedEdges"] = [];

  for (const e of raw.prerequisites ?? []) {
    const skillKey = (e.skill_key ?? "").trim();
    const prereqKey = (e.prereq_key ?? "").trim();
    const edge: ExtractedEdge = {
      skillKey,
      prereqKey,
      rationale: (e.rationale ?? "").trim(),
    };

    if (!validKeys.has(skillKey) || !validKeys.has(prereqKey)) {
      rejectedEdges.push({ edge, reason: "references a skill that was not extracted" });
      continue;
    }
    if (skillKey === prereqKey) {
      rejectedEdges.push({ edge, reason: "a skill cannot require itself" });
      continue;
    }

    // Cycles are checked incrementally against the edges accepted so far, so the
    // first edge of a cycle survives and only the edge that closes it is dropped.
    // Validating up front matters because the database trigger would otherwise
    // reject one insert mid-import and leave a half-written graph behind.
    const candidate: PrereqEdge[] = [
      ...edges.map((x) => ({ skillId: x.skillKey, prereqSkillId: x.prereqKey })),
      { skillId: skillKey, prereqSkillId: prereqKey },
    ];
    const { acyclic, cycle } = findCycle(candidate);
    if (!acyclic) {
      rejectedEdges.push({
        edge,
        reason: `would create a circular dependency: ${cycle!.join(" → ")}`,
      });
      continue;
    }

    edges.push(edge);
  }

  return { skills, edges, rejectedEdges };
}
