"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { applySm2 } from "@/lib/sm2";
import ScopeGuidance from "./ScopeGuidance";

interface Props {
  skillId: string;
  skillName: string;
  defaultMinutes: number;
  onLogged: () => void;
  onCancel: () => void;
}

const QUALITY_LABELS: Record<number, string> = {
  0: "Complete blackout",
  1: "Wrong, but recognized after",
  2: "Wrong, but it felt familiar",
  3: "Recalled with serious difficulty",
  4: "Recalled with some hesitation",
  5: "Perfect recall",
};

export default function SessionForm({
  skillId,
  skillName,
  defaultMinutes,
  onLogged,
  onCancel,
}: Props) {
  const [duration, setDuration] = useState(defaultMinutes);
  const [quality, setQuality] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (quality === null) return;

    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setError("Not authenticated");
      setLoading(false);
      return;
    }

    const { data: currentState } = await supabase
      .from("sr_state")
      .select("*")
      .eq("skill_id", skillId)
      .single();

    if (!currentState) {
      setError("Could not load skill state");
      setLoading(false);
      return;
    }

    const before = {
      repetitions: currentState.repetitions,
      easeFactor: Number(currentState.ease_factor),
      intervalDays: currentState.interval_days,
    };

    const after = applySm2(before, quality);
    const now = new Date();
    const dueAt = new Date(
      now.getTime() + after.intervalDays * 24 * 60 * 60 * 1000
    );

    const { error: sessionError } = await supabase.from("sessions").insert({
      user_id: user.id,
      skill_id: skillId,
      duration_minutes: duration,
      quality,
      note: note.trim() || null,
      sm2_repetitions_before: before.repetitions,
      sm2_ease_before: before.easeFactor,
      sm2_interval_before: before.intervalDays,
      sm2_repetitions_after: after.repetitions,
      sm2_ease_after: after.easeFactor,
      sm2_interval_after: after.intervalDays,
      due_at_after: dueAt.toISOString(),
    });

    if (sessionError) {
      setError(sessionError.message);
      setLoading(false);
      return;
    }

    const { error: updateError } = await supabase
      .from("sr_state")
      .update({
        repetitions: after.repetitions,
        ease_factor: after.easeFactor,
        interval_days: after.intervalDays,
        last_reviewed_at: now.toISOString(),
        due_at: dueAt.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("skill_id", skillId);

    if (updateError) {
      setError(updateError.message);
      setLoading(false);
      return;
    }

    onLogged();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <form
        onSubmit={handleSubmit}
        className="bg-white rounded-lg p-6 w-full max-w-md space-y-4"
      >
        <h3 className="text-lg font-semibold text-gray-900">
          Log session: {skillName}
        </h3>

        <ScopeGuidance variant="session" />

        <div>
          <label className="text-sm text-gray-600 block mb-1">
            Duration (minutes)
          </label>
          <input
            type="number"
            min={1}
            max={300}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-24 px-2 py-1 border border-gray-300 rounded-md text-sm text-gray-900"
          />
        </div>

        <div>
          <label className="text-sm text-gray-600 block mb-2">
            How well did you recall this material?
          </label>
          <div className="space-y-1">
            {[0, 1, 2, 3, 4, 5].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setQuality(q)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  quality === q
                    ? "bg-gray-900 text-white"
                    : "bg-gray-50 text-gray-700 hover:bg-gray-100"
                }`}
              >
                <span className="font-medium">{q}</span>
                <span className="text-xs ml-2 opacity-75">
                  {QUALITY_LABELS[q]}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-sm text-gray-600 block mb-1">
            Notes (optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 placeholder-gray-400"
            placeholder="What did you practice? What was difficult?"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            disabled={loading || quality === null}
            className="px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-800 disabled:opacity-50"
          >
            {loading ? "Saving…" : "Log session"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
