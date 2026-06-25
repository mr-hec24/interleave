"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { applySm2 } from "@/lib/sm2";

interface Props {
  skillId: string;
  skillName: string;
  defaultMinutes: number;
  nextSkillName?: string | null;
  onLogged: () => void;
  onSwitchToNext?: () => void;
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

type Phase = "practice" | "rate";

export default function SessionForm({
  skillId,
  skillName,
  defaultMinutes,
  nextSkillName,
  onLogged,
  onSwitchToNext,
  onCancel,
}: Props) {
  const [phase, setPhase] = useState<Phase>("practice");
  const [secondsLeft, setSecondsLeft] = useState(defaultMinutes * 60);
  const [isRunning, setIsRunning] = useState(true);
  const [timerDone, setTimerDone] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [quality, setQuality] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (!isRunning || phase !== "practice") return;

    intervalRef.current = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setTimerDone(true);
          setIsRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning, phase]);

  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const elapsed = Math.round(elapsedSeconds / 60);

  function handleFinishPractice() {
    setIsRunning(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    setPhase("rate");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (quality === null) return;

    setLoading(true);
    setError(null);

    const actualMinutes = Math.max(1, Math.round(elapsedSeconds / 60));

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
      duration_minutes: actualMinutes,
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
      <div className="bg-white rounded-lg p-6 w-full max-w-md space-y-4">
        {phase === "practice" ? (
          <>
            <h3 className="text-lg font-semibold text-gray-900">
              {skillName}
            </h3>

            {/* Timer display */}
            <div className="text-center py-6">
              <div
                className={`text-5xl font-mono tabular-nums ${
                  timerDone ? "text-amber-600" : "text-gray-900"
                }`}
              >
                {minutes}:{seconds.toString().padStart(2, "0")}
              </div>
              {timerDone && (
                <p className="text-sm text-amber-600 mt-2 font-medium">
                  Time&apos;s up!
                </p>
              )}
            </div>

            {/* Switch nudge — appears only when timer finishes */}
            {timerDone && nextSkillName && (
              <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3 text-sm">
                <p className="text-blue-900 font-medium">
                  Time to switch
                </p>
                <p className="text-blue-700 mt-0.5">
                  Your brain will thank you. <strong>{nextSkillName}</strong> is
                  up next — rate this session and move on.
                </p>
                {onSwitchToNext && (
                  <button
                    type="button"
                    onClick={() => {
                      handleFinishPractice();
                    }}
                    className="mt-2 text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    Rate &amp; switch →
                  </button>
                )}
              </div>
            )}

            {/* Timer controls */}
            <div className="flex items-center justify-center gap-3">
              {!timerDone && (
                <button
                  type="button"
                  onClick={() => setIsRunning((r) => !r)}
                  className="px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  {isRunning ? "Pause" : "Resume"}
                </button>
              )}
              <button
                type="button"
                onClick={handleFinishPractice}
                className="px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-800"
              >
                {timerDone ? "Rate this session" : "Finish early"}
              </button>
            </div>

            {/* Elapsed time (subtle) */}
            <p className="text-xs text-gray-400 text-center">
              {elapsed > 0
                ? `${elapsed} min elapsed`
                : "Just started"}
            </p>

            <button
              type="button"
              onClick={onCancel}
              className="w-full text-center text-sm text-gray-400 hover:text-gray-600 pt-2"
            >
              Cancel session
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">
              Rate: {skillName}
            </h3>

            <p className="text-xs text-gray-500">
              You practiced for {elapsed || 1} min. Take your time rating
              — this step is never timed.
            </p>

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
        )}
      </div>
    </div>
  );
}
