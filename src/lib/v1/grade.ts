/**
 * The forced 4-point grade scale (§3).
 *
 * Shared vocabulary between the memory model that consumes grades and the event log
 * that records them, which is why it lives on its own rather than inside either.
 *
 * Two properties matter and both are deliberate.
 *
 * **Forced choice.** §3 disallows free self-rating, citing Kornell & Bjork (2008):
 * unconstrained self-assessment is systematically overconfident. Four labelled
 * options is not merely a coarser slider — it removes the middle ground the
 * optimistic rater drifts toward.
 *
 * **Learner-supplied, and honestly so.** Interleave spans arbitrary domains and
 * cannot auto-grade a guitar exercise the way a flashcard app grades a fact. The
 * grade is a self-report. What makes it interpretable is not that the system
 * verified it but that it is anchored to a *specific retrieval cue* (see
 * prompts.ts): "did you recall this particular thing?" admits a defensible answer
 * in a way that "how's your Spanish?" does not. That is mitigation, not a solution,
 * and it is documented as such in docs/research-synthesis.md §3.1.
 */

export type Grade = "again" | "hard" | "good" | "easy";

export const GRADES: readonly Grade[] = ["again", "hard", "good", "easy"] as const;

/** `again` is the lapse boundary: the retrieval failed and stability collapses. */
export function isLapse(grade: Grade): boolean {
  return grade === "again";
}

/**
 * Ordinal rank, 1–4. For arithmetic that needs an ordering (difficulty updates,
 * calibration bucketing). Never used as a magnitude — the scale is ordinal, and
 * treating the gap between `hard` and `good` as equal to the gap between `good`
 * and `easy` would be assuming an interval property it does not have.
 */
export function gradeRank(grade: Grade): 1 | 2 | 3 | 4 {
  switch (grade) {
    case "again":
      return 1;
    case "hard":
      return 2;
    case "good":
      return 3;
    case "easy":
      return 4;
  }
}

/**
 * Maps the retired SM-2 0–5 self-rating onto the 4-point scale, for migrating
 * historical rows.
 *
 * The boundary at 3 is SM-2's own: quality < 3 triggers a repetition reset, so
 * 0–2 are the failures. The mapping is lossy in the other direction and is only
 * ever applied to pre-v1 data, which the log tags `sm2` precisely so that anything
 * training or calibrating on it can exclude the pre-measurement era outright.
 */
export function gradeFromLegacyQuality(quality: number): Grade {
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) {
    throw new Error(`legacy quality must be an integer 0–5, got ${quality}`);
  }
  if (quality <= 2) return "again";
  if (quality === 3) return "hard";
  if (quality === 4) return "good";
  return "easy";
}
