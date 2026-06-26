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

const R_THRESHOLD = 0.85;

export function computeRetrievability(
  daysSinceReview: number,
  stabilityDays: number
): number {
  if (stabilityDays <= 0) return 0;
  return Math.exp(-daysSinceReview / stabilityDays);
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
