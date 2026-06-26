import type { Health } from "@/components/Plant";
import type { SchedulerRecommendation } from "./scheduler";

/**
 * Maps a skill's scheduler state onto one of the four plant-health states from
 * the design spec. Thresholds mirror docs/design-language.md and the design's
 * accessibility spec:
 *   - flowering: retrievability ≥ 90% AND interval > 60d (durable memory)
 *   - strong:    retrievability ≥ 85%
 *   - fading:    50–85%
 *   - overdue:   < 50% / past due (and new skills, which need a first session)
 */
export function healthFromRec(rec: SchedulerRecommendation): Health {
  if (rec.isNew) return "fading";
  const r = rec.retrievability;
  if (r >= 0.9 && rec.intervalDays > 60) return "flowering";
  if (r >= 0.85) return "strong";
  if (r >= 0.5) return "fading";
  return "overdue";
}

export function retrPct(rec: SchedulerRecommendation): number {
  return rec.isNew ? 0 : Math.round(rec.retrievability * 100);
}
