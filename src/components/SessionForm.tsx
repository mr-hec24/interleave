"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { applySm2 } from "@/lib/sm2";
import Plant from "./Plant";
import GrowingTimerLeaf from "./GrowingTimerLeaf";

interface Props {
  skillId: string;
  skillName: string;
  defaultMinutes: number;
  nextSkillName?: string | null;
  onLogged: () => void;
  onSwitchToNext?: () => void;
  onCancel: () => void;
}

const QUALITY = [
  { q: 0, label: "Blank" },
  { q: 1, label: "Familiar" },
  { q: 2, label: "Hard effort" },
  { q: 3, label: "After a pause" },
  { q: 4, label: "Confident" },
  { q: 5, label: "Effortless" },
];

type Phase = "practice" | "recall" | "switch";

const RING = 2 * Math.PI * 86; // circumference for r=86

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
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(true);
  const [timerDone, setTimerDone] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [quality, setQuality] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [nextInterval, setNextInterval] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    if (!isRunning || phase !== "practice") return;
    intervalRef.current = setInterval(() => {
      setElapsedSeconds((p) => p + 1);
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
  const totalSeconds = defaultMinutes * 60;
  const progress = totalSeconds > 0 ? Math.min(1, elapsedSeconds / totalSeconds) : 0;

  function endPractice() {
    setIsRunning(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
    setPhase("recall");
  }

  async function handleLog() {
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
    const dueAt = new Date(now.getTime() + after.intervalDays * 86400000);

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

    setNextInterval(after.intervalDays);
    setLoading(false);
    if (nextSkillName && onSwitchToNext) {
      setPhase("switch");
    } else {
      onLogged();
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface rounded-2xl w-full max-w-3xl overflow-hidden shadow-xl border border-edge max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="h-[62px] bg-surface-2 border-b border-edge flex items-center justify-between px-6">
          <span className="font-round font-semibold text-xl text-ink">
            interleaf
          </span>
          <div className="flex items-center gap-4">
            <span className="text-xs font-medium text-ink-soft">
              {phase === "practice"
                ? "Practice mode"
                : phase === "recall"
                  ? "Session complete"
                  : "Keep the momentum"}
            </span>
            <button
              onClick={onCancel}
              className="text-xs font-semibold text-ink-soft hover:text-ink border border-edge rounded-lg px-4 py-2"
            >
              Save &amp; exit
            </button>
          </div>
        </div>

        {phase === "practice" && (
          <div className="p-10 flex flex-col items-center">
            <div className="text-[11px] font-bold tracking-widest uppercase text-green-deep">
              Practising · {skillName}
            </div>

            {/* Timer ring + growing leaf */}
            <div
              role="img"
              aria-label={`Session ${Math.round(progress * 100)} percent complete, about ${minutes} minutes left. Your leaf is growing.`}
              className="relative w-[220px] h-[220px] flex items-center justify-center mt-8"
            >
              <svg
                width="220"
                height="220"
                viewBox="0 0 200 200"
                aria-hidden="true"
                className="absolute inset-0 -rotate-90"
              >
                <circle cx="100" cy="100" r="86" fill="none" stroke="var(--border)" strokeWidth="10" />
                <circle
                  cx="100"
                  cy="100"
                  r="86"
                  fill="none"
                  stroke="var(--green)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={RING}
                  strokeDashoffset={RING * (1 - progress)}
                  style={{ transition: "stroke-dashoffset 1s linear" }}
                />
              </svg>
              <GrowingTimerLeaf progress={progress} done={timerDone} size={120} />
            </div>

            <div className="font-display text-3xl text-ink mt-4 tabular-nums">
              {timerDone ? "Fully grown" : `${minutes}:${seconds.toString().padStart(2, "0")}`}
            </div>
            <div className="text-sm text-ink-soft text-center mt-1 mb-6">
              Recall rating comes after — no rush.
            </div>

            <div className="flex gap-3 w-full max-w-sm">
              {!timerDone && (
                <button
                  onClick={() => setIsRunning((r) => !r)}
                  className="flex-1 text-sm font-semibold text-ink-soft bg-surface border border-tint-border rounded-xl py-3"
                >
                  {isRunning ? "Pause" : "Resume"}
                </button>
              )}
              <button
                onClick={endPractice}
                className="flex-1 text-sm font-semibold text-on-green bg-green-btn rounded-xl py-3"
              >
                {timerDone ? "Rate this session" : "End now"}
              </button>
            </div>
            <div className="text-[11px] text-ink-mute mt-4 text-center">
              Calm by design — the growing animation honours “Reduce Motion”.
            </div>
          </div>
        )}

        {phase === "recall" && (
          <div className="px-10 sm:px-14 pt-10 pb-12 flex flex-col items-center">
            <div role="img" aria-label={`Your ${skillName} plant bloomed — session complete.`}>
              <Plant health="flowering" label={skillName} size={110} showText={false} decorative />
            </div>
            <div className="font-display font-semibold text-3xl text-ink mt-3 text-center">
              It bloomed — nicely done.
            </div>
            <div className="text-sm text-ink-soft mt-1 text-center">
              {skillName} is back to full health.
              {nextInterval ? ` Next review scheduled in ~${nextInterval} days.` : ""}
            </div>

            <div className="w-full max-w-2xl border-t border-edge mt-8 pt-7 text-center">
              <div className="font-display font-semibold text-2xl text-ink">
                How well did it come back?
              </div>
              <p className="text-sm text-ink-soft mx-auto mt-1.5 mb-6 max-w-lg leading-relaxed">
                There&apos;s <b className="text-ink">no timer here</b>. Take your time and
                answer honestly — your rating tunes the next interval.
              </p>

              <div
                role="radiogroup"
                aria-label="Recall rating from 0 to 5"
                className="grid grid-cols-3 sm:grid-cols-6 gap-3"
              >
                {QUALITY.map(({ q, label }) => {
                  const selected = quality === q;
                  return (
                    <button
                      key={q}
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setQuality(q)}
                      className={`flex flex-col items-center gap-2 rounded-2xl py-4 px-2 border transition-colors ${
                        selected
                          ? "bg-tint border-green"
                          : "bg-surface border-edge hover:border-tint-border"
                      }`}
                    >
                      <span className={`font-mono font-bold text-2xl ${selected ? "text-tint-ink" : "text-ink-soft"}`}>
                        {q}
                      </span>
                      <span className={`text-xs ${selected ? "font-semibold text-ink" : "font-medium text-ink-soft"} text-center`}>
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Notes (optional) — what did you practice? What was difficult?"
                className="w-full mt-5 px-3 py-2 border border-edge rounded-xl text-sm bg-surface text-ink placeholder-ink-mute"
              />

              {error && <p className="text-sm text-red-600 mt-3">{error}</p>}

              <button
                onClick={handleLog}
                disabled={loading || quality === null}
                className="font-semibold text-on-green bg-green-btn rounded-xl py-3 px-10 mt-6 disabled:opacity-50"
              >
                {loading ? "Saving…" : "Continue →"}
              </button>
            </div>
          </div>
        )}

        {phase === "switch" && (
          <div className="px-10 sm:px-14 pt-11 pb-12">
            <div className="flex items-center justify-center gap-6">
              <div className="flex flex-col items-center opacity-90">
                <Plant health="flowering" label={skillName} size={78} showText={false} decorative />
                <span className="text-xs font-medium text-ink-mute mt-0.5">just practised</span>
              </div>
              <svg width="150" height="92" viewBox="0 0 200 120" aria-hidden="true">
                <path d="M30,108 C 30,56 170,64 170,12" stroke="var(--green)" strokeWidth="8" fill="none" strokeLinecap="round" />
                <path d="M170,108 C 170,56 30,64 30,12" stroke="var(--clay)" strokeWidth="8" fill="none" strokeLinecap="round" />
              </svg>
              <div className="flex flex-col items-center">
                <Plant health="strong" label={nextSkillName ?? ""} size={86} showText={false} decorative />
                <span className="text-xs font-semibold text-green-deep mt-0.5">up next</span>
              </div>
            </div>

            <div className="text-center max-w-xl mx-auto mt-2">
              <div className="text-[11px] font-bold tracking-widest uppercase text-clay mt-4">
                Time to interleave
              </div>
              <div className="font-display font-semibold text-3xl text-ink mt-2 mb-2.5">
                Move on to {nextSkillName}
              </div>
              <p className="text-sm text-ink-soft leading-relaxed mb-6">
                Switching now — rather than repeating {skillName} — is what makes both
                stick. This is interleaving at work.
              </p>
              <div className="flex gap-3.5 justify-center flex-wrap">
                <button
                  onClick={() => onSwitchToNext?.()}
                  className="font-semibold text-on-green bg-green-btn rounded-xl py-3.5 px-7"
                >
                  Start {nextSkillName} →
                </button>
                <button
                  onClick={onLogged}
                  className="font-semibold text-ink-soft bg-transparent border border-edge rounded-xl py-3.5 px-7"
                >
                  I&apos;m done for today
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
