import type { Health } from "@/components/Plant";
import type { RankedSkill, ExcludedSkill } from "@/lib/v1/controller";

/**
 * Maps a skill's v1 state onto one of the four plant-health states.
 *
 * Rebased from SM-2 intervals onto retrievability and stability. The thresholds
 * still mirror `docs/design-language.md`, but they now read the quantities the
 * scheduler actually decides on, so the picture on screen and the ranking behind it
 * cannot disagree.
 *
 *   - flowering: R ≥ 0.9 and durable (a year of stability)
 *   - strong:    R ≥ 0.85
 *   - fading:    0.5 – 0.85
 *   - overdue:   < 0.5, including never-practised skills
 */
export function healthFromRanked(rec: {
  retrievability: number;
  stability?: number | null;
}): Health {
  const r = rec.retrievability;
  if (r >= 0.9 && (rec.stability ?? 0) > 365) return "flowering";
  if (r >= 0.85) return "strong";
  if (r >= 0.5) return "fading";
  return "overdue";
}

export function retrPct(rec: { retrievability: number }): number {
  return Math.round(rec.retrievability * 100);
}

/**
 * @deprecated Adapter for the reminder cron, the last caller still on the old
 * SM-2-shaped recommendation type. Removed with that port in 008.
 */
export function healthFromRec(rec: {
  isNew: boolean;
  retrievability: number;
  intervalDays: number;
}): Health {
  if (rec.isNew) return "fading";
  return healthFromRanked({
    retrievability: rec.retrievability,
    stability: rec.intervalDays,
  });
}

/**
 * Why a skill isn't in the rotation, in the learner's terms.
 *
 * §6 and the measurement layer both exclude skills rather than penalising them, so
 * an excluded skill simply vanishes from the ranking. Without an explanation that is
 * indistinguishable from a bug, which is why the controller returns a reason and
 * this turns it into a sentence.
 */
export function exclusionCopy(
  excluded: ExcludedSkill,
  nameFor: (skillId: string) => string
): string {
  if (excluded.reason === "no_prompts") {
    return "No retrieval cue yet — add one and it joins the rotation.";
  }
  const blocking = excluded.unmetPrereqs.map(nameFor).filter(Boolean);
  if (blocking.length === 0) return "Waiting on a prerequisite.";
  return `Waiting on ${blocking.join(" and ")}.`;
}

/**
 * The one-line reason a skill is where it is in the ranking.
 *
 * Names the dominant term rather than reciting all four. The full breakdown is a
 * row below in the data view; this is the sentence someone reads in passing, and a
 * sentence that lists every component says nothing.
 */
export function formatUtilityReason(rec: RankedSkill, epsilon: number): string {
  const pct = retrPct(rec);

  if (rec.interference > 0.5 && rec.interferenceFrom) {
    return `Held back — closely related to what you just practised (${Math.round(
      rec.interferenceFrom.sim * 100
    )}% similar), so spacing them apart is worth more than doing both now.`;
  }
  if (rec.fatigue > 0.6) {
    return `Recall is around ${pct}%, but this leans on channels you've been using heavily — it would be effortful for the wrong reason right now.`;
  }
  if (rec.urgency >= 0.99) {
    return `Recall has fallen to about ${pct}%. This is as urgent as it gets — every day longer makes the retrieval harder without making it more valuable.`;
  }
  if (rec.urgency > 0.6) {
    return `Recall is around ${pct}% — effortful enough to be worth retrieving, likely enough to succeed.`;
  }
  if (rec.readiness < 0.4) {
    return `Recall is around ${pct}%, but its groundwork is still thin, so a retrieval now would likely fail rather than strengthen.`;
  }
  return `Recall is still around ${pct}% — retrieving it now would be too easy to teach much. Utility ${rec.utility.toFixed(
    2
  )}, below the ${epsilon.toFixed(2)} margin needed to interrupt anything.`;
}
