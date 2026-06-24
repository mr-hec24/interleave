"use client";

import { formatReasonText } from "@/lib/scheduler";
import type { SchedulerRecommendation } from "@/lib/scheduler";

interface Props {
  recommendation: SchedulerRecommendation;
  onStartSession: () => void;
}

export default function RecommendationCard({
  recommendation,
  onStartSession,
}: Props) {
  return (
    <div className="bg-gray-900 text-white rounded-lg p-6">
      <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">
        Practice next
      </p>
      <h2 className="text-xl font-bold">{recommendation.skillName}</h2>
      <p className="text-sm text-gray-300 mt-2">
        {formatReasonText(recommendation)}
      </p>
      <div className="flex items-center justify-between mt-4">
        <span className="text-sm text-gray-400">
          {recommendation.sessionMinutes} min suggested
        </span>
        <button
          onClick={onStartSession}
          className="bg-white text-gray-900 text-sm font-medium px-4 py-2 rounded-md hover:bg-gray-100"
        >
          Log session
        </button>
      </div>
    </div>
  );
}
