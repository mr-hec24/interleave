"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { fromWire, type ClientContext, type WireSessionContext } from "@/lib/v1/session/wire";
import {
  createSessionState,
  serveNextPrompt,
  recordAttempt,
  evaluateSwitch,
  finishBlock,
  moveTo,
  rank,
  elapsedMinutes,
  type SessionState,
  type EngineDeps,
} from "@/lib/v1/session/engine";
import { toUVector, simContextFor, type RankedSkill } from "@/lib/v1/controller";
import {
  logSessionStart,
  logReview,
  logSwitch,
  logSessionEnd,
  computeErrorDrift,
} from "@/lib/v1/events";
import { GRADES, type Grade } from "@/lib/v1/grade";
import Plant from "./Plant";

interface Props {
  /** Skill to open on. Null lets the controller choose. */
  initialSkillId?: string | null;
  onExit: () => void;
}

type Phase = "loading" | "cue" | "grade" | "switch" | "wrap" | "empty" | "error";

const GRADE_COPY: Record<Grade, { label: string; hint: string }> = {
  again: { label: "Blank", hint: "Couldn't retrieve it" },
  hard: { label: "Struggled", hint: "Got there, but it was hard work" },
  good: { label: "Recalled", hint: "Came back with effort" },
  easy: { label: "Instant", hint: "No hesitation at all" },
};

/**
 * A practice session, as §7 defines it.
 *
 * There is no countdown and no configured block length. The learner is shown one
 * retrieval cue, goes away and attempts it, comes back and grades it. After each
 * attempt the controller re-ranks, and the block ends only when a rival skill beats
 * the incumbent by more than ε — "session length is emergent" made literal.
 *
 * The elapsed clock on screen is informational. Nothing reads it.
 */
/**
 * What the UI draws from.
 *
 * The engine's `SessionState` is mutable by design — attempts advance it in place —
 * so it lives in a ref rather than React state. Rendering directly from that ref
 * would be a correctness bug: a mutation wouldn't schedule a re-render, and what's
 * on screen could silently drift from what the controller believes. Every mutation
 * therefore ends with a snapshot pushed into React state, and render reads only
 * this.
 */
interface ViewModel {
  skillName: string;
  cueText: string | null;
  attemptCount: number;
  epsilon: number;
}

export default function PracticeSession({ initialSkillId = null, onExit }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [vm, setVm] = useState<ViewModel | null>(null);
  const [fatigueReport, setFatigueReport] = useState<number | null>(null);
  const [switchTarget, setSwitchTarget] = useState<RankedSkill | null>(null);
  const [switchMargin, setSwitchMargin] = useState(0);

  const ctxRef = useRef<ClientContext | null>(null);
  const stateRef = useRef<SessionState | null>(null);
  const depsRef = useRef<EngineDeps | null>(null);
  const userIdRef = useRef<string | null>(null);
  const supabase = createClient();

  const syncView = useCallback(() => {
    const s = stateRef.current;
    const d = depsRef.current;
    if (!s || !d) return;
    setVm({
      skillName: s.skills.find((x) => x.id === s.currentSkillId)?.name ?? "",
      cueText: s.currentPrompt?.text ?? null,
      attemptCount: s.attempts.length,
      epsilon: d.config.epsilon,
    });
  }, []);

  // Elapsed clock, for the learner only. Deliberately not wired to anything that
  // decides — a block that ended because a timer fired would not be emergent.
  useEffect(() => {
    if (phase === "loading") return;
    const update = () => {
      const s = stateRef.current;
      if (s) setElapsed(Math.floor(elapsedMinutes(s, new Date())));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        const res = await fetch("/api/session/context");
        if (!res.ok) throw new Error("Could not load your scheduler state.");
        const wire: WireSessionContext = await res.json();
        if (cancelled) return;

        const context = fromWire(wire);
        const now = new Date();
        const session = createSessionState(
          crypto.randomUUID(),
          context.skills,
          context.saturation,
          context.promptsBySkill,
          now
        );
        const deps: EngineDeps = {
          config: context.config,
          prereqEdges: context.prereqEdges,
          similarityGraph: context.similarityGraph,
        };

        const ranking = rank(session, deps, now);
        if (ranking.ranked.length === 0) {
          ctxRef.current = context;
          stateRef.current = session;
          depsRef.current = deps;
          setPhase("empty");
          return;
        }

        // Honour an explicit pick when it is actually schedulable; otherwise the
        // controller chooses. Silently overriding the learner would be worse than
        // either, so a non-schedulable pick falls through to the top candidate and
        // the exclusion reason is visible on the dashboard.
        const opening =
          (initialSkillId &&
            ranking.ranked.find((r) => r.skillId === initialSkillId)?.skillId) ||
          ranking.ranked[0].skillId;

        userIdRef.current = user.id;
        ctxRef.current = context;
        stateRef.current = session;
        depsRef.current = deps;
        moveTo(session, opening, now);

        await logSessionStart(supabase, {
          userId: user.id,
          sessionId: session.sessionId,
          skillId: opening,
          uVector: toUVector(ranking.ranked),
          satState: session.saturation,
          simContext: null,
          embeddingProvider: context.embeddingProvider,
        });

        serveNextPrompt(session, deps, new Date());
        if (!cancelled) {
          syncView();
          setPhase("cue");
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not start the session.");
        setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistSkill = useCallback(
    async (skillId: string, stability: number | null, difficulty: number, at: Date) => {
      await supabase
        .from("skills")
        .update({
          stability_days: stability,
          difficulty,
          last_reviewed_at: at.toISOString(),
        })
        .eq("id", skillId);
    },
    [supabase]
  );

  async function submitGrade(grade: Grade) {
    const s = stateRef.current;
    const d = depsRef.current;
    const c = ctxRef.current;
    const userId = userIdRef.current;
    if (!s || !d || !c || !userId) return;

    const now = new Date();
    const attempt = recordAttempt(s, d, grade, now);
    syncView();

    await logReview(supabase, {
      userId,
      sessionId: s.sessionId,
      skillId: attempt.skillId,
      promptRef: attempt.promptId,
      attemptIndex: attempt.attemptIndex,
      grade: attempt.grade,
      deltaT: attempt.deltaT,
      rPred: attempt.rPred,
      sBefore: attempt.sBefore,
      sAfter: attempt.sAfter,
      difficulty: attempt.difficulty,
      latencySeconds: attempt.latencySeconds,
      ts: now,
    });

    await supabase
      .from("retrieval_prompts")
      .update({
        last_served_at: now.toISOString(),
        times_served: s.promptsBySkill
          .get(attempt.skillId)!
          .find((p) => p.id === attempt.promptId)!.timesServed,
      })
      .eq("id", attempt.promptId);

    // The only thing that ends a block.
    const decision = evaluateSwitch(s, d, now);
    if (decision.shouldSwitch && decision.target) {
      setSwitchTarget(decision.target);
      setSwitchMargin(decision.margin);
      syncView();
      setPhase("switch");
      return;
    }

    // Same skill, next cue. An empty pool mid-block means the skill stopped being
    // practisable, so treat it as a forced end rather than showing nothing.
    if (!serveNextPrompt(s, d, new Date())) {
      await endBlockAndWrap();
      return;
    }
    syncView();
    setPhase("cue");
  }

  async function commitBlock(at: Date): Promise<void> {
    const s = stateRef.current;
    const d = depsRef.current;
    if (!s || !d) return;
    const outcome = finishBlock(s, d, at);
    if (!outcome) return;
    await persistSkill(outcome.skillId, outcome.sAfter, outcome.difficulty, at);
  }

  async function acceptSwitch() {
    const s = stateRef.current;
    const d = depsRef.current;
    const c = ctxRef.current;
    const userId = userIdRef.current;
    if (!s || !d || !c || !userId || !switchTarget) return;

    const now = new Date();
    const leaving = s.currentSkillId!;
    await commitBlock(now);

    await logSwitch(supabase, {
      userId,
      sessionId: s.sessionId,
      fromSkillId: leaving,
      skillId: switchTarget.skillId,
      uVector: toUVector(rank(s, d, now).ranked),
      satState: s.saturation,
      simContext: simContextFor(d.similarityGraph, switchTarget.skillId, leaving),
      utilityMargin: switchMargin,
      controllerInitiated: true,
      ts: now,
    });

    moveTo(s, switchTarget.skillId, now);
    setSwitchTarget(null);
    if (!serveNextPrompt(s, d, new Date())) {
      await endBlockAndWrap();
      return;
    }
    syncView();
    setPhase("cue");
  }

  /** The learner declined the switch. Recorded as disagreement — that is the metric. */
  async function declineSwitch() {
    const s = stateRef.current;
    const d = depsRef.current;
    const userId = userIdRef.current;
    if (!s || !d || !userId) return;

    const now = new Date();
    await logSwitch(supabase, {
      userId,
      sessionId: s.sessionId,
      fromSkillId: s.currentSkillId!,
      skillId: null,
      uVector: toUVector(rank(s, d, now).ranked),
      satState: s.saturation,
      simContext: null,
      utilityMargin: switchMargin,
      controllerInitiated: false,
      ts: now,
    });

    setSwitchTarget(null);
    if (!serveNextPrompt(s, d, new Date())) {
      await endBlockAndWrap();
      return;
    }
    syncView();
    setPhase("cue");
  }

  async function endBlockAndWrap() {
    await commitBlock(new Date());
    syncView();
    setPhase("wrap");
  }

  async function finishSession() {
    const s = stateRef.current;
    const d = depsRef.current;
    const userId = userIdRef.current;
    if (!s || !d || !userId) return onExit();

    const now = new Date();
    await commitBlock(now);

    const latencies = s.attempts.map((a) => a.latencySeconds);
    const sorted = [...latencies].sort((a, b) => a - b);
    const median =
      sorted.length === 0
        ? 0
        : sorted.length % 2 === 0
          ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
          : sorted[Math.floor(sorted.length / 2)];

    await logSessionEnd(supabase, {
      userId,
      sessionId: s.sessionId,
      skillId: s.currentSkillId,
      sessionDur: elapsedMinutes(s, now),
      satState: s.saturation,
      fatigueReport,
      latencyStats: latencies.length ? { attempts: latencies, medianSeconds: median } : null,
      errorDrift: computeErrorDrift(latencies),
      ts: now,
    });

    // Persist saturation so the next session decays forward from a real reading
    // rather than assuming the learner arrives rested.
    await supabase
      .from("user_channel_state")
      .update({ sat: s.saturation, updated_at: now.toISOString() })
      .eq("user_id", userId);

    onExit();
  }

  const cueText = vm?.cueText ?? null;
  const skillName = vm?.skillName ?? "";
  const attemptCount = vm?.attemptCount ?? 0;

  const shellCls =
    "fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto";
  const cardCls =
    "bg-surface rounded-2xl w-full max-w-2xl overflow-hidden shadow-xl border border-edge max-h-[92vh] overflow-y-auto";

  if (phase === "loading" || phase === "error" || phase === "empty") {
    return (
      <div className={shellCls}>
        <div className={cardCls}>
          <div className="p-10 text-center">
            {phase === "loading" && (
              <p className="text-sm text-ink-mute">Working out what to practise…</p>
            )}
            {phase === "error" && (
              <>
                <p className="text-sm text-red-600">{error}</p>
                <button
                  onClick={onExit}
                  className="mt-6 font-semibold text-ink-soft border border-edge rounded-xl px-6 py-3"
                >
                  Close
                </button>
              </>
            )}
            {phase === "empty" && (
              <>
                <div className="font-display font-semibold text-2xl text-ink">
                  Nothing is practisable yet
                </div>
                <p className="text-[15px] text-ink-soft mt-3 leading-relaxed max-w-md mx-auto">
                  Every skill is either waiting on a prerequisite or has no retrieval
                  cue. Add a cue to a skill and it will join the rotation.
                </p>
                <button
                  onClick={onExit}
                  className="mt-6 font-semibold text-on-green bg-green-btn rounded-xl px-6 py-3"
                >
                  Back to the garden
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

    return (
    <div className={shellCls}>
      <div className={cardCls}>
        <div className="h-[62px] bg-surface-2 border-b border-edge flex items-center justify-between px-6">
          <span className="font-round font-semibold text-xl text-ink">interleaf</span>
          <div className="flex items-center gap-4">
            <span className="text-xs font-medium text-ink-mute tabular-nums">
              {elapsed} min · {attemptCount} recalled
            </span>
            <button
              onClick={endBlockAndWrap}
              className="text-xs font-semibold text-ink-soft hover:text-ink border border-edge rounded-lg px-4 py-2"
            >
              Wrap up
            </button>
          </div>
        </div>

        {phase === "cue" && cueText && (
          <div className="px-8 sm:px-12 pt-10 pb-12">
            <div className="text-[11px] font-bold tracking-widest uppercase text-green-deep text-center">
              {skillName}
            </div>

            <div className="bg-tint border border-tint-border rounded-2xl px-6 py-7 mt-6">
              <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-tint-ink mb-2">
                Retrieve this
              </div>
              <p className="font-display text-xl sm:text-2xl text-ink leading-snug whitespace-pre-wrap">
                {cueText}
              </p>
            </div>

            <p className="text-sm text-ink-soft text-center mt-6 leading-relaxed max-w-md mx-auto">
              Go and do it — on your instrument, in your editor, on paper. Come back
              when you&apos;ve attempted it. <b className="text-ink">There&apos;s no
              timer.</b>
            </p>

            <button
              onClick={() => setPhase("grade")}
              className="w-full max-w-xs mx-auto block font-semibold text-on-green bg-green-btn rounded-xl py-3.5 mt-7"
            >
              I&apos;ve attempted it
            </button>
          </div>
        )}

        {phase === "grade" && cueText && (
          <div className="px-8 sm:px-12 pt-10 pb-12">
            <div className="text-center">
              <div className="font-display font-semibold text-2xl text-ink">
                How did that come back?
              </div>
              <p className="text-sm text-ink-soft mt-2 max-w-lg mx-auto leading-relaxed">
                Rate the retrieval you just attempted — not the skill in general.
                There&apos;s no clock on this part.
              </p>
            </div>

            <div className="bg-surface-2 border border-edge rounded-xl px-4 py-3 mt-6">
              <p className="text-xs text-ink-soft whitespace-pre-wrap">
                {cueText}
              </p>
            </div>

            <div
              role="radiogroup"
              aria-label="Recall rating"
              className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6"
            >
              {GRADES.map((g) => (
                <button
                  key={g}
                  role="radio"
                  aria-checked={false}
                  onClick={() => submitGrade(g)}
                  className="flex flex-col items-center gap-1.5 rounded-2xl py-4 px-2 border border-edge bg-surface hover:border-tint-border transition-colors"
                >
                  <span className="font-semibold text-[15px] text-ink">
                    {GRADE_COPY[g].label}
                  </span>
                  <span className="text-[11px] text-ink-mute text-center leading-tight">
                    {GRADE_COPY[g].hint}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {phase === "switch" && switchTarget && (
          <div className="px-8 sm:px-12 pt-11 pb-12 text-center">
            <div className="flex items-center justify-center gap-6">
              <div className="flex flex-col items-center opacity-90">
                <Plant health="flowering" label="" size={72} showText={false} decorative />
                <span className="text-xs font-medium text-ink-mute mt-0.5">
                  {skillName}
                </span>
              </div>
              <svg width="130" height="80" viewBox="0 0 200 120" aria-hidden="true">
                <path d="M30,108 C 30,56 170,64 170,12" stroke="var(--green)" strokeWidth="8" fill="none" strokeLinecap="round" />
                <path d="M170,108 C 170,56 30,64 30,12" stroke="var(--clay)" strokeWidth="8" fill="none" strokeLinecap="round" />
              </svg>
              <div className="flex flex-col items-center">
                <Plant health="strong" label="" size={82} showText={false} decorative />
                <span className="text-xs font-semibold text-green-deep mt-0.5">
                  {switchTarget.skillName}
                </span>
              </div>
            </div>

            <div className="text-[11px] font-bold tracking-widest uppercase text-clay mt-5">
              Time to interleave
            </div>
            <div className="font-display font-semibold text-2xl sm:text-3xl text-ink mt-2">
              Move to {switchTarget.skillName}
            </div>
            <p className="text-sm text-ink-soft leading-relaxed mt-3 max-w-lg mx-auto">
              {switchTarget.skillName} now scores higher than {skillName} by{" "}
              <span className="font-mono">{switchMargin.toFixed(2)}</span> — past the{" "}
              <span className="font-mono">
                {(vm?.epsilon ?? 0).toFixed(2)}
              </span>{" "}
              margin that keeps blocks from thrashing. Switching now is what creates
              the spacing that makes both stick.
            </p>

            <div className="flex flex-wrap gap-3 justify-center mt-7">
              <button
                onClick={acceptSwitch}
                className="font-semibold text-on-green bg-green-btn rounded-xl py-3.5 px-7"
              >
                Start {switchTarget.skillName} →
              </button>
              <button
                onClick={declineSwitch}
                className="font-semibold text-ink-soft border border-edge rounded-xl py-3.5 px-7"
              >
                Stay on this one
              </button>
              <button
                onClick={endBlockAndWrap}
                className="font-medium text-ink-mute hover:text-ink text-sm px-3"
              >
                I&apos;m done
              </button>
            </div>
          </div>
        )}

        {phase === "wrap" && (
          <div className="px-8 sm:px-12 pt-11 pb-12 text-center">
            <Plant health="flowering" label="" size={100} showText={false} decorative />
            <div className="font-display font-semibold text-2xl sm:text-3xl text-ink mt-4">
              {attemptCount} retrieval
              {attemptCount === 1 ? "" : "s"} in {elapsed} min
            </div>

            <div className="border-t border-edge mt-8 pt-7">
              <div className="font-display font-semibold text-xl text-ink">
                How drained do you feel?
              </div>
              <p className="text-sm text-ink-soft mt-1.5 mb-5 max-w-md mx-auto leading-relaxed">
                One tap. This is the only way Interleaf can learn how quickly{" "}
                <i>you</i> tire — the published research doesn&apos;t supply that
                number for anyone.
              </p>
              <div className="flex gap-2 justify-center flex-wrap">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    onClick={() => setFatigueReport(n)}
                    className={`w-14 h-14 rounded-xl border font-display font-bold text-lg transition-colors ${
                      fatigueReport === n
                        ? "bg-tint border-green text-tint-ink"
                        : "bg-surface border-edge text-ink-soft hover:border-tint-border"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <div className="flex justify-center gap-8 text-[11px] text-ink-mute mt-2">
                <span>fresh</span>
                <span>spent</span>
              </div>
            </div>

            <button
              onClick={finishSession}
              className="font-semibold text-on-green bg-green-btn rounded-xl py-3.5 px-8 mt-8"
            >
              {fatigueReport === null ? "Skip and finish" : "Finish"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
