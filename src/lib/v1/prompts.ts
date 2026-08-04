/**
 * Retrieval prompts — the atomic unit of measurement.
 *
 * The architecture spec defines a controller with no plant: it says how to choose
 * what to practise in exhaustive detail, and says almost nothing about what a
 * practice event *is*. Everything downstream of §3 assumes a discrete, gradeable
 * retrieval event exists for a skill. This module supplies it.
 *
 *     event = (skill_id, prompt_ref, attempt_index, grade, duration)
 *
 * A prompt is a *cue*, never an exercise and never a test. The learner performs the
 * retrieval in the real world — their instrument, their editor, their notebook —
 * and grades it. Interleave does not verify the performance; it verifies that a
 * retrieval was attempted against a specific, named cue. That is what makes the
 * forced 4-point scale (§3) mean anything: FSRS grades work because the cue is
 * fixed, and "how's your Spanish?" has no fixed cue.
 *
 * Stability stays on the *skill* node in v1 (§2), with the prompt pool feeding it.
 * Per-prompt stability would split an already-thin event stream 3–5 ways, and §8
 * sequences versions by data physics. Logging prompt_ref yields the item-response
 * dataset regardless, so v2's HLR can go per-prompt when the data supports it.
 */

/** Provenance of a cue. See 005_retrieval_prompts.sql for why this is load-bearing. */
export type PromptSource = "llm" | "user" | "migrated";

export interface RetrievalPrompt {
  id: string;
  skillId: string;
  text: string;
  source: PromptSource;
  /** Null when never served — those sort first. */
  lastServedAt: Date | null;
  timesServed: number;
}

/**
 * Least-recently-served selection, with a deterministic tie-break.
 *
 * Two reasons this is LRU rather than random. It guarantees pool coverage, so a
 * skill's stability reflects its whole prompt set rather than whichever cue kept
 * winning a coin flip. And it is itself a within-pool spacing mechanism: the gap
 * between successive servings of one cue is maximised for free, which is the same
 * effect §7 is buying at the between-skill level, one level down.
 *
 * The `jitter` argument breaks lockstep cycling when a pool is served repeatedly in
 * one session — without it a 3-prompt pool becomes a fixed A,B,C,A,B,C rotation the
 * learner can anticipate, which is a mild cueing confound. Callers pass a seeded
 * PRNG so simulations and tests stay reproducible.
 *
 * @param pool  live (non-archived) prompts for one skill
 * @param rand  uniform [0,1); pass a seeded PRNG for determinism
 * @returns     the prompt to serve, or null if the pool is empty
 */
export function selectPrompt(
  pool: RetrievalPrompt[],
  rand: () => number = Math.random
): RetrievalPrompt | null {
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0];

  const staleness = (p: RetrievalPrompt) =>
    p.lastServedAt === null ? Number.POSITIVE_INFINITY : -p.lastServedAt.getTime();

  const sorted = [...pool].sort((a, b) => {
    const d = staleness(b) - staleness(a);
    if (d !== 0) return d > 0 ? 1 : -1;
    // Equal staleness: prefer the less-served cue, then fall back to id order so
    // the result never depends on input ordering.
    if (a.timesServed !== b.timesServed) return a.timesServed - b.timesServed;
    return a.id < b.id ? -1 : 1;
  });

  // Never-served prompts are served first, unconditionally — a cue with no data is
  // worth more than a jitter coin flip, and it is the only way a new prompt enters
  // the calibration record.
  if (sorted[0].lastServedAt === null) return sorted[0];

  // Otherwise take the stalest, but with a small chance of the runner-up so the
  // rotation is not perfectly predictable.
  const JITTER_PROBABILITY = 0.25;
  if (sorted.length > 1 && rand() < JITTER_PROBABILITY) return sorted[1];
  return sorted[0];
}

/**
 * The scheduling invariant.
 *
 * A skill with no live prompt has no gradeable retrieval, so scheduling it would
 * manufacture exactly the undefined-measurement grade the prompt layer exists to
 * prevent. Such skills are removed from the candidate set entirely and surfaced as
 * "needs setup" — never silently ranked, and never silently dropped without the
 * learner being told why.
 *
 * Applied at the same point in the pipeline as §6's reachability mask, and for the
 * same reason: both are hard exclusions, not soft penalties.
 */
export function isSchedulable(promptPoolSize: number): boolean {
  return promptPoolSize > 0;
}

/**
 * A migrated placeholder stands in for a retrieval whose actual cue was never
 * recorded. Any calibration or training run that treats one as a genuine item is
 * contaminating itself with the pre-measurement era, so callers filter on this.
 */
export function isPlaceholder(prompt: RetrievalPrompt): boolean {
  return prompt.source === "migrated";
}
