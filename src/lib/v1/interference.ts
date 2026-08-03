/**
 * §7 — the semantic interference penalty.
 *
 *     Intf_i(t) = max_{j ∈ N_similar(i)} sim(i,j) · 1[j practised within window w]
 *
 * This is the concrete, measurable form of "prevent semantic saturation". It
 * penalises scheduling a skill semantically adjacent to what was just practised, so
 * consecutive blocks are pushed apart in meaning rather than merely in identity.
 *
 * ## Why `max` and not a sum
 *
 * A sum would make a skill's penalty grow with how many of its neighbours happened
 * to be practised recently, which conflates two different things: *how close* the
 * nearest recent skill is, and *how many* recent skills there were. Only the first
 * is what semantic saturation means. A sum would also interact badly with the
 * degree cap — the penalty would depend on graph density, an artefact of how the
 * edges were built rather than a property of the learner's state.
 *
 * ## The honesty this term buys
 *
 * The design's cross-domain benefit is claimed via forced spacing and
 * contextual-interference-style variability, explicitly *not* via the classic
 * discriminative-contrast account, which requires confusable categories that
 * unrelated domains lack (Brunmair & Richter, 2019). Because `sim` is measured
 * rather than assumed, the scheduler knows which similarity regime it is in — and
 * §11 can A/B this term on and off against the measured regime instead of arguing
 * about it.
 *
 * It is ¶NOVEL. Nothing here is validated; it is instrumented so it can be.
 */

import type { SimilarityGraph } from "./similarity";

/** A skill practised recently enough to still exert interference. */
export interface RecentPractice {
  skillId: string;
  /** Blocks ago: 1 = the block just finished. */
  blocksAgo: number;
}

/**
 * Window `w`, in blocks. §7 sets it to ~1 session — interference is about what you
 * *just* did, not about the general shape of the week.
 */
export const DEFAULT_INTERFERENCE_WINDOW = 1;

/**
 * Intf_i on [0,1].
 *
 * @param skillId  candidate skill
 * @param graph    E_similar adjacency
 * @param recent   recently-practised skills with their recency in blocks
 * @param window   how many blocks back still count
 */
export function interference(
  skillId: string,
  graph: SimilarityGraph,
  recent: readonly RecentPractice[],
  window: number = DEFAULT_INTERFERENCE_WINDOW
): number {
  const neighbours = graph.get(skillId);
  if (!neighbours || neighbours.size === 0) return 0;

  let worst = 0;
  for (const practice of recent) {
    if (practice.blocksAgo > window || practice.blocksAgo < 1) continue;
    // A skill is not its own interferer: repeating the same skill is a
    // block-length question, which §7 leaves to fatigue and the hysteresis margin.
    if (practice.skillId === skillId) continue;
    const sim = neighbours.get(practice.skillId);
    if (sim !== undefined && sim > worst) worst = sim;
  }
  return worst;
}

/**
 * Which recent skill is responsible for a skill's interference penalty.
 *
 * For the explanation surface — "held back because you just did X, which is 0.81
 * similar" is auditable in a way that a bare penalty number is not, and the design's
 * whole trust argument rests on the reasoning being visible.
 */
export function interferenceSource(
  skillId: string,
  graph: SimilarityGraph,
  recent: readonly RecentPractice[],
  window: number = DEFAULT_INTERFERENCE_WINDOW
): { skillId: string; sim: number } | null {
  const neighbours = graph.get(skillId);
  if (!neighbours) return null;

  let best: { skillId: string; sim: number } | null = null;
  for (const practice of recent) {
    if (practice.blocksAgo > window || practice.blocksAgo < 1) continue;
    if (practice.skillId === skillId) continue;
    const sim = neighbours.get(practice.skillId);
    if (sim !== undefined && (best === null || sim > best.sim)) {
      best = { skillId: practice.skillId, sim };
    }
  }
  return best;
}
