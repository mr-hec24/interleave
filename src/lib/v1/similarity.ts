/**
 * §2 — E_similar construction.
 *
 * Undirected edges weighted by cos(e_i, e_j), thresholded and degree-capped. This
 * edge set is what makes the semantic-spacing claim measurable rather than
 * rhetorical: it defines Intf_i (§7) and, in v3, the transfer pathway (§9.4).
 *
 * It is also the system's direct answer to Brunmair & Richter (2019). Their
 * meta-analysis found the interleaving benefit is strongest for *confusable*
 * categories and weak or absent for dissimilar ones. A scheduler that measures
 * similarity knows which regime it is operating in, rather than assuming one — and
 * `sim_context` on every event (§10) is what lets that be checked after the fact.
 */

import { cosineSimilarity, type Embedding } from "./embeddings/provider";

export interface SimilarEdge {
  skillA: string;
  skillB: string;
  sim: number;
}

export interface SimilarityOptions {
  /** Below this, two skills are not semantically adjacent. §2 suggests 0.6. */
  threshold: number;
  /** Max edges per node. §2 suggests 10. */
  degreeCap: number;
}

export const DEFAULT_SIMILARITY_OPTIONS: SimilarityOptions = {
  threshold: 0.6,
  degreeCap: 10,
};

/**
 * Builds the similarity edge set for one user's skills.
 *
 * Edges are stored canonically with `skillA < skillB` so each undirected pair
 * appears exactly once, matching the database's primary key and check constraint.
 *
 * ## The degree cap is not just a performance guard
 *
 * Capping degree bounds the graph, but its real job is protecting Intf_i from a
 * pathology. Intf takes a `max` over similar neighbours, so a skill connected to
 * everything would be penalised whenever *anything* was practised recently, and
 * would effectively drop out of the rotation. Keeping the strongest k neighbours
 * means the penalty reflects genuine adjacency rather than an artefact of a skill
 * being described in generic language.
 *
 * The cap is applied greedily by descending similarity and enforced symmetrically:
 * an edge survives only if it fits within *both* endpoints' budgets, so the stored
 * graph is a valid undirected graph rather than one whose meaning depends on which
 * side you read it from.
 */
export function buildSimilarityEdges(
  skills: ReadonlyArray<{ id: string; embedding: Embedding }>,
  options: SimilarityOptions = DEFAULT_SIMILARITY_OPTIONS
): SimilarEdge[] {
  const candidates: SimilarEdge[] = [];

  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const sim = cosineSimilarity(skills[i].embedding, skills[j].embedding);
      if (sim <= options.threshold) continue;
      const [a, b] =
        skills[i].id < skills[j].id
          ? [skills[i].id, skills[j].id]
          : [skills[j].id, skills[i].id];
      candidates.push({ skillA: a, skillB: b, sim });
    }
  }

  // Strongest first, with a deterministic tie-break so a rebuild on unchanged data
  // produces an identical edge set — otherwise the scheduler would drift for
  // reasons invisible in the log.
  candidates.sort((x, y) => {
    if (y.sim !== x.sim) return y.sim - x.sim;
    if (x.skillA !== y.skillA) return x.skillA < y.skillA ? -1 : 1;
    return x.skillB < y.skillB ? -1 : 1;
  });

  const degree = new Map<string, number>();
  const kept: SimilarEdge[] = [];
  for (const edge of candidates) {
    const da = degree.get(edge.skillA) ?? 0;
    const db = degree.get(edge.skillB) ?? 0;
    if (da >= options.degreeCap || db >= options.degreeCap) continue;
    degree.set(edge.skillA, da + 1);
    degree.set(edge.skillB, db + 1);
    kept.push(edge);
  }
  return kept;
}

/** Adjacency lookup: skill id → its similar neighbours and weights. */
export type SimilarityGraph = ReadonlyMap<string, ReadonlyMap<string, number>>;

export function buildSimilarityGraph(edges: readonly SimilarEdge[]): SimilarityGraph {
  const graph = new Map<string, Map<string, number>>();
  const link = (from: string, to: string, sim: number) => {
    const existing = graph.get(from);
    if (existing) existing.set(to, sim);
    else graph.set(from, new Map([[to, sim]]));
  };
  for (const e of edges) {
    link(e.skillA, e.skillB, e.sim);
    link(e.skillB, e.skillA, e.sim);
  }
  return graph;
}

/**
 * Max similarity between a skill and the previously-practised block's skill.
 *
 * Logged as `sim_context` on every scheduling event. Without it you cannot recover,
 * after the fact, whether the scheduler was operating in a regime where similarity
 * existed to be exploited at all — which is precisely what distinguishes "the
 * interference penalty did nothing" from "there was nothing for it to do".
 */
export function similarityTo(
  graph: SimilarityGraph,
  skillId: string,
  otherSkillId: string | null
): number {
  if (!otherSkillId || otherSkillId === skillId) return 0;
  return graph.get(skillId)?.get(otherSkillId) ?? 0;
}
