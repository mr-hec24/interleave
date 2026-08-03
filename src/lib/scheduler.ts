import { retrievability, daysUntilRetrievability } from "./v1/memory";

export interface SkillSchedulerInput {
  skillId: string;
  skillName: string;
  intervalDays: number;
  lastReviewedAt: Date | null;
  defaultSessionMinutes: number;
}

export interface SchedulerRecommendation {
  skillId: string;
  skillName: string;
  retrievability: number;
  daysSinceReview: number | null;
  intervalDays: number;
  priorityScore: number;
  sessionMinutes: number;
  isNew: boolean;
}

export const R_THRESHOLD = 0.85;

/**
 * Delegates to the v1 memory model rather than carrying its own copy of the decay
 * curve.
 *
 * `intervalDays` now holds the operational stability S — days until R decays to 0.9
 * — because that is what the session flow writes. The local `exp(-Δt/S)` this used
 * to compute interpreted the same number as the raw exponential scale, which places
 * R = 0.9 at 0.105·S instead of at S, and so under-reported retrievability by a wide
 * margin for every skill on the dashboard.
 */
export function computeRetrievability(
  daysSinceReview: number,
  stabilityDays: number
): number {
  return retrievability(daysSinceReview, stabilityDays > 0 ? stabilityDays : null);
}

/**
 * Days from now until a skill decays to the review threshold. Negative when it is
 * already overdue.
 *
 * Exists because this arithmetic was previously inlined at six call sites in the
 * dashboard using two different formulas, which produced two different answers on
 * screen at the same time. One definition, one answer.
 */
export function daysUntilDue(rec: SchedulerRecommendation): number {
  if (rec.isNew) return 0;
  const stability = Math.max(rec.intervalDays, 1);
  const daysToThreshold = daysUntilRetrievability(R_THRESHOLD, stability) ?? 0;
  return daysToThreshold - (rec.daysSinceReview ?? 0);
}

export function rankSkills(
  skills: SkillSchedulerInput[],
  now: Date
): SchedulerRecommendation[] {
  const recommendations: SchedulerRecommendation[] = skills.map((skill) => {
    if (!skill.lastReviewedAt) {
      return {
        skillId: skill.skillId,
        skillName: skill.skillName,
        retrievability: 0,
        daysSinceReview: null,
        intervalDays: skill.intervalDays,
        priorityScore: Infinity,
        sessionMinutes: skill.defaultSessionMinutes,
        isNew: true,
      };
    }

    const daysSinceReview =
      (now.getTime() - skill.lastReviewedAt.getTime()) / (1000 * 60 * 60 * 24);

    const stability = Math.max(skill.intervalDays, 1);
    const retrievability = computeRetrievability(daysSinceReview, stability);

    const priorityScore = retrievability < R_THRESHOLD
      ? R_THRESHOLD - retrievability
      : 0;

    return {
      skillId: skill.skillId,
      skillName: skill.skillName,
      retrievability: Math.round(retrievability * 1000) / 1000,
      daysSinceReview: Math.round(daysSinceReview * 10) / 10,
      intervalDays: skill.intervalDays,
      priorityScore: Math.round(priorityScore * 1000) / 1000,
      sessionMinutes: skill.defaultSessionMinutes,
      isNew: false,
    };
  });

  return recommendations.sort((a, b) => b.priorityScore - a.priorityScore);
}

export function formatReasonText(rec: SchedulerRecommendation): string {
  if (rec.isNew) {
    return `${rec.skillName} is new and hasn't been practiced yet. Starting it now establishes a baseline for spaced repetition.`;
  }

  if (rec.priorityScore === 0) {
    return `${rec.skillName} was reviewed ${rec.daysSinceReview} days ago. Retrievability is still high (${Math.round(rec.retrievability * 100)}%), so reviewing now would be too easy — no desirable difficulty.`;
  }

  const pct = Math.round(rec.retrievability * 100);
  return `${rec.skillName} was last practiced ${rec.daysSinceReview} days ago (interval: ${rec.intervalDays}d). Estimated recall is ${pct}%, which is in the desirable difficulty zone — effortful but still achievable.`;
}
