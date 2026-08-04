"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { retrievability, applyReview, daysUntilRetrievability, type MemoryState } from "@/lib/v1/memory";
import { urgency } from "@/lib/v1/urgency";
import { chargeAfterSession, decayAfterIdle, fatiguePenalty, CHANNELS } from "@/lib/v1/fatigue";
import { computeUtility } from "@/lib/v1/controller";
import { DEFAULT_CONFIG } from "@/lib/v1/config";
import type { Grade } from "@/lib/v1/grade";
import ThemeToggle from "@/components/ThemeToggle";
import {
  DecayChart,
  UtilityChart,
  FatigueChart,
  Slider,
  type Point,
  type ReviewMark,
  type UtilityTerm,
} from "./charts";

/**
 * An explorable explanation of the v1 scheduler.
 *
 * Everything on this page is computed by the **shipped** model functions —
 * `retrievability`, `applyReview`, `urgency`, `computeUtility`, the fatigue
 * integrator. Nothing is reimplemented for display. That is the point: a diagram
 * that approximates the model becomes a lie the first time someone tunes a
 * constant, and this exists precisely to reason about tuning constants.
 */

/** Default window. Adjustable, because at a low target the schedule degenerates
 *  into near-daily review and a long window collapses into an unreadable block —
 *  which is the finding, but only legible if you can also zoom in on it. */
const DEFAULT_WINDOW = 90;

/** Deterministic, so dragging a slider changes the model and not the dice. */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function gradeFor(r: number, rand: () => number): Grade {
  // Retrievability is a probability of successful recall — so sample it, don't
  // threshold it. This is the single most load-bearing line on the page: it is why
  // a low target produces mostly failures.
  if (rand() >= r) return "again";
  if (r < 0.5) return "hard";
  if (r < 0.85) return "good";
  return "easy";
}

interface Life {
  points: Point[];
  reviews: ReviewMark[];
  finalStability: number;
  lapseRate: number;
  meanInterval: number;
}

/**
 * Walks one skill forward, scheduling each review at the exact moment recall
 * reaches θ.
 *
 * Solving for the crossing rather than stepping day by day matters more than it
 * looks. Once stability collapses below a day — which is precisely what a low θ
 * causes — a daily check finds recall already near zero, so the measured lapse rate
 * comes out far above the model's own prediction. Scheduling exactly makes the
 * failure rate come out at 1 − θ, which is the honest number and the one worth
 * arguing about.
 */
function simulateLife(theta: number, initialS: number, seed: number, DAYS: number): Life {
  const rand = makeRng(seed);
  let state: MemoryState = { stability: initialS, difficulty: 5 };
  const points: Point[] = [];
  const reviews: ReviewMark[] = [];

  let t = 0;
  const SAMPLES_PER_GAP = 14;

  while (t < DAYS && reviews.length < 400) {
    const gap = daysUntilRetrievability(theta, state.stability);
    if (gap === null || !Number.isFinite(gap) || gap <= 0) break;

    // Trace the decay curve across this interval for the chart.
    for (let k = 0; k <= SAMPLES_PER_GAP; k++) {
      const dt = (gap * k) / SAMPLES_PER_GAP;
      if (t + dt > DAYS) break;
      points.push({ x: t + dt, y: retrievability(dt, state.stability) });
    }

    const reviewAt = t + gap;
    if (reviewAt > DAYS) break;

    // By construction recall is exactly θ at this moment, so the outcome is a draw
    // against θ itself.
    const grade = gradeFor(theta, rand);
    reviews.push({ x: reviewAt, y: theta, grade, lapse: grade === "again" });
    state = applyReview(state, gap, grade).next;
    t = reviewAt;
  }

  // Tail: decay from the last review to the end of the window.
  for (let k = 0; k <= SAMPLES_PER_GAP && t + k <= DAYS; k++) {
    points.push({ x: t + k, y: retrievability(k, state.stability) });
  }

  const lapses = reviews.filter((r) => r.lapse).length;
  const intervals = reviews.map((r, i) => (i === 0 ? r.x : r.x - reviews[i - 1].x));
  return {
    points,
    reviews,
    finalStability: state.stability ?? 0,
    lapseRate: reviews.length ? lapses / reviews.length : 0,
    meanInterval: intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0,
  };
}

export default function ModelExplorer() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const el = document.documentElement;
    const sync = () => setDark(el.classList.contains("dark"));
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  // ── Panel 1 ──────────────────────────────────────────────────────────────
  const [theta, setTheta] = useState(DEFAULT_CONFIG.theta);
  const [initialS, setInitialS] = useState(1);
  const [seed, setSeed] = useState(7);
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW);
  const life = useMemo(
    () => simulateLife(theta, initialS, seed, windowDays),
    [theta, initialS, seed, windowDays]
  );

  const nextDue = daysUntilRetrievability(theta, life.finalStability);

  // ── Panel 2 ──────────────────────────────────────────────────────────────
  const [alpha, setAlpha] = useState(DEFAULT_CONFIG.alpha);
  const [beta, setBeta] = useState(DEFAULT_CONFIG.beta);
  const [gamma, setGamma] = useState(DEFAULT_CONFIG.gamma);
  const [delta, setDelta] = useState(DEFAULT_CONFIG.delta);
  const [epsilon, setEpsilon] = useState(DEFAULT_CONFIG.epsilon);
  const [sigma, setSigma] = useState(DEFAULT_CONFIG.sigma);
  const [rNow, setRNow] = useState(0.4);
  const [satNow, setSatNow] = useState(0.3);
  const [readyNow, setReadyNow] = useState(0.8);
  const [intfNow, setIntfNow] = useState(0.0);

  const utility = useMemo(() => {
    const d = urgency(rNow, theta, sigma);
    const components = { urgency: d, fatigue: satNow, readiness: readyNow, interference: intfNow };
    const total = computeUtility(components, { ...DEFAULT_CONFIG, alpha, beta, gamma, delta, theta, sigma }, 1);
    const terms: UtilityTerm[] = [
      { label: "Urgency", raw: d, weighted: alpha * d, sign: 1 },
      { label: "Fatigue", raw: satNow, weighted: -beta * satNow, sign: -1 },
      { label: "Readiness", raw: readyNow, weighted: gamma * readyNow, sign: 1 },
      { label: "Interference", raw: intfNow, weighted: -delta * intfNow, sign: -1 },
    ];
    return { terms, total, d };
  }, [rNow, theta, sigma, satNow, readyNow, intfNow, alpha, beta, gamma, delta]);

  // ── Panel 3 ──────────────────────────────────────────────────────────────
  const [tau, setTau] = useState(50);
  const [rho, setRho] = useState(75);
  const SESSION_MIN = 180;
  const BLOCK_END = 60;

  const fatigueSeries = useMemo(() => {
    const constants = {
      tauMinutes: [tau, tau, tau, tau],
      rhoMinutes: [rho, rho, rho, rho],
    };
    // A logical-heavy skill, so the channels visibly diverge.
    const loading = [0.7, 0.2, 0.1, 0];
    let sat: number[] = [0, 0, 0, 0];
    const out: number[][] = [[], [], [], []];
    for (let m = 0; m <= SESSION_MIN; m++) {
      sat =
        m < BLOCK_END
          ? chargeAfterSession(sat, loading, 1, constants)
          : decayAfterIdle(sat, 1, constants);
      sat.forEach((v, i) => out[i].push(v));
    }
    return { out, penalty: fatiguePenalty(loading, sat) };
  }, [tau, rho]);

  const card = "bg-surface border border-edge rounded-2xl p-5 sm:p-6";
  const h2 = "font-display font-semibold text-xl text-ink";
  const body = "text-[14px] text-ink-soft leading-relaxed";

  return (
    <div className="min-h-screen bg-paper">
      <header className="bg-surface border-b border-edge">
        <div className="max-w-4xl mx-auto h-16 px-6 flex items-center justify-between">
          <Link href="/" className="font-round font-semibold text-2xl text-ink">
            interleaf
          </Link>
          <div className="flex items-center gap-4">
            <span className="text-xs text-ink-mute hidden sm:inline">model explorer</span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="font-display font-semibold text-3xl sm:text-4xl text-ink leading-tight">
            How the scheduler decides
          </h1>
          <p className={`${body} mt-3 max-w-2xl`}>
            Every number on this page is computed by the same functions the app runs —
            not a diagram of them. Move a slider and you are changing the real model.
            Nothing here touches your skills; it is a sandbox for reasoning about the
            algorithm.
          </p>
        </div>

        {/* ── Panel 1 ────────────────────────────────────────────────────── */}
        <section className={card}>
          <h2 className={h2}>1. One skill, left to itself</h2>
          <p className={`${body} mt-2`}>
            Memory decays as <span className="font-mono text-[13px]">R = 0.9^(Δt/S)</span> —
            stability <span className="font-mono text-[13px]">S</span> is the number of days
            until recall falls to 90%. When recall reaches the target{" "}
            <span className="font-mono text-[13px]">θ</span>, the scheduler asks for a review.
            A successful review multiplies S, so the gaps stretch; a failed one collapses it.
          </p>
          <p className={`${body} mt-2`}>
            <b className="text-ink">The outcome is sampled from R, not thresholded.</b>{" "}
            Retrievability <i>is</i> the probability of recall, so scheduling at θ = 0.35
            means roughly two thirds of reviews are expected to fail. Orange dots are lapses.
          </p>

          <div className="mt-5">
            <DecayChart
              points={life.points}
              reviews={life.reviews}
              theta={theta}
              dark={dark}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            {[
              { label: `reviews in ${windowDays}d`, value: String(life.reviews.length) },
              { label: "mean gap", value: `${life.meanInterval.toFixed(1)}d` },
              {
                label: "lapse rate",
                value: `${Math.round(life.lapseRate * 100)}%`,
                warn: life.lapseRate > 0.4,
              },
              { label: "final stability", value: `${life.finalStability.toFixed(1)}d` },
            ].map((s) => (
              <div key={s.label} className="bg-surface-2 rounded-xl px-3 py-2.5">
                <div
                  className={`font-display font-bold text-xl tabular-nums ${
                    s.warn ? "text-clay" : "text-ink"
                  }`}
                >
                  {s.value}
                </div>
                <div className="text-[10px] text-ink-mute">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-5 pt-5 border-t border-edge">
            <Slider
              label="θ — target retrievability"
              hint="Where the scheduler aims each review. v1 default 0.35."
              value={theta}
              min={0.2}
              max={0.95}
              step={0.05}
              onChange={setTheta}
            />
            <Slider
              label="Initial stability"
              hint="Days until recall hits 90%, before any review."
              value={initialS}
              min={0.5}
              max={20}
              step={0.5}
              onChange={setInitialS}
              format={(v) => `${v}d`}
            />
            <Slider
              label="Window"
              hint="How much of the skill’s life to show."
              value={windowDays}
              min={20}
              max={240}
              step={10}
              onChange={setWindowDays}
              format={(v) => `${v}d`}
            />
            <div className="flex flex-col justify-end">
              <button
                onClick={() => setSeed((s) => s + 1)}
                className="text-xs font-semibold text-ink-soft border border-edge rounded-xl px-4 py-2 hover:text-ink"
              >
                Roll a different learner
              </button>
              <p className="text-[10px] text-ink-mute mt-1 leading-snug">
                Same model, different luck on each retrieval.
              </p>
            </div>
          </div>

          <div className="bg-tint border border-tint-border rounded-xl px-4 py-3 mt-5">
            <p className="text-xs text-ink-soft leading-relaxed">
              <b className="text-tint-ink">Try this:</b> drag θ from 0.35 up to 0.85. Reviews get
              more frequent, but the lapse rate collapses and final stability climbs — because
              every failure costs 72% of accumulated stability, and at a low target most reviews
              fail. This is the tension the simulator&apos;s{" "}
              <span className="font-mono">npm run simulate:theta</span> sweep measures.
            </p>
          </div>
        </section>

        {/* ── Panel 2 ────────────────────────────────────────────────────── */}
        <section className={card}>
          <h2 className={h2}>2. Why this skill, and not another</h2>
          <p className={`${body} mt-2`}>
            With several skills in play, decay is only one of four terms. The scheduler scores
            each skill and picks the highest — but only switches away from what you are already
            doing if the winner leads by more than{" "}
            <span className="font-mono text-[13px]">ε</span>. That margin is the only thing
            controlling how rapidly it interleaves.
          </p>
          <p className="font-mono text-[13px] text-ink mt-3">
            U = αD − βF + γReady − δIntf
          </p>

          <div className="mt-4">
            <UtilityChart terms={utility.terms} total={utility.total} epsilon={epsilon} dark={dark} />
          </div>

          <p className={`${body} mt-3`}>
            {utility.total >= epsilon ? (
              <>
                At <span className="font-mono">U = {utility.total.toFixed(2)}</span> this skill
                clears the <span className="font-mono">ε = {epsilon.toFixed(2)}</span> margin — it
                is worth interrupting for.
              </>
            ) : (
              <>
                At <span className="font-mono">U = {utility.total.toFixed(2)}</span> this skill sits
                below the <span className="font-mono">ε = {epsilon.toFixed(2)}</span> margin.
                Nothing happens: not worth interrupting for.
              </>
            )}
          </p>

          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4 mt-5 pt-5 border-t border-edge">
            <Slider
              label="Current recall (R)"
              hint={`Urgency D = ${utility.d.toFixed(2)}. Peaks at θ and stays there below it — an overdue skill never becomes less urgent.`}
              value={rNow}
              min={0}
              max={1}
              step={0.01}
              onChange={setRNow}
            />
            <Slider
              label="σ — band tolerance"
              hint="How sharply urgency falls off for a skill reviewed too early."
              value={sigma}
              min={0.05}
              max={0.5}
              step={0.01}
              onChange={setSigma}
            />
            <Slider
              label="Channel fatigue"
              hint="How tired the channels this skill uses already are."
              value={satNow}
              min={0}
              max={1}
              step={0.01}
              onChange={setSatNow}
            />
            <Slider
              label="Readiness"
              hint="Mastery of the weakest prerequisite."
              value={readyNow}
              min={0}
              max={1}
              step={0.01}
              onChange={setReadyNow}
            />
            <Slider
              label="Interference"
              hint="Similarity to whatever was just practised."
              value={intfNow}
              min={0}
              max={1}
              step={0.01}
              onChange={setIntfNow}
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-5 pt-5 border-t border-edge">
            <Slider label="α urgency" value={alpha} min={0} max={2} step={0.05} onChange={setAlpha} />
            <Slider label="β fatigue" value={beta} min={0} max={2} step={0.05} onChange={setBeta} />
            <Slider label="γ readiness" value={gamma} min={0} max={2} step={0.05} onChange={setGamma} />
            <Slider label="δ interference" value={delta} min={0} max={2} step={0.05} onChange={setDelta} />
            <Slider label="ε margin" value={epsilon} min={0} max={1} step={0.01} onChange={setEpsilon} />
          </div>

          <div className="bg-tint border border-tint-border rounded-xl px-4 py-3 mt-5">
            <p className="text-xs text-ink-soft leading-relaxed">
              <b className="text-tint-ink">Try this:</b> set β to 0. That is the ablation arm the
              design calls for — it tests whether the fatigue term earns its place at all. Then
              note that if every skill has the same channel loadings, β cancels out of every
              comparison regardless of its value, which is a bug this app had until recently.
            </p>
          </div>
        </section>

        {/* ── Panel 3 ────────────────────────────────────────────────────── */}
        <section className={card}>
          <h2 className={h2}>3. Fatigue, and why it recovers</h2>
          <p className={`${body} mt-2`}>
            Four cognitive channels charge while you practise and discharge while you rest, as
            leaky integrators. A skill&apos;s cost is its loadings dotted with current saturation —
            so an hour of debugging makes another logical skill expensive and leaves a motor one
            almost free. Below: one hour on a logic-heavy skill, then two hours off.
          </p>
          <p className={`${body} mt-2`}>
            <b className="text-ink">τ and ρ are guesses.</b> The literature supports that fatigue
            exists but supplies no reliable time constants, so these are placeholders to be fitted
            from real self-reports and latency drift.
          </p>

          <div className="mt-5">
            <FatigueChart
              series={fatigueSeries.out}
              labels={[...CHANNELS]}
              minutes={SESSION_MIN}
              blockEnd={BLOCK_END}
              dark={dark}
            />
          </div>

          <div className="grid sm:grid-cols-2 gap-4 mt-5 pt-5 border-t border-edge">
            <Slider
              label="τ — time to fatigue"
              hint="Minutes of full load to reach 63% saturation."
              value={tau}
              min={10}
              max={120}
              step={5}
              onChange={setTau}
              format={(v) => `${v}m`}
            />
            <Slider
              label="ρ — recovery constant"
              hint="Minutes of rest to shed 63% of saturation."
              value={rho}
              min={10}
              max={180}
              step={5}
              onChange={setRho}
              format={(v) => `${v}m`}
            />
          </div>
        </section>

        <section className={card}>
          <h2 className={h2}>What this leaves out</h2>
          <ul className={`${body} mt-2 space-y-2 list-disc pl-5`}>
            <li>
              The decay curve is exponential for closed-form convenience. Real forgetting fits a
              power law better; S is defined by an observable (days to 90% recall) so the curve
              can be swapped later without invalidating stored values.
            </li>
            <li>
              Every validated decay model targets discrete memorised items. Applying one to a
              whole skill is an assumption the app instruments rather than inherits — per-cue
              calibration curves are how it gets tested.
            </li>
            <li>
              The panel-1 learner recalls exactly as often as the model predicts. A real learner
              may not, which is the entire point of measuring calibration.
            </li>
          </ul>
          {nextDue !== null && (
            <p className={`${body} mt-4`}>
              For reference, a skill ending at{" "}
              <span className="font-mono">S = {life.finalStability.toFixed(1)}d</span> next comes due
              in <b className="text-ink">{nextDue.toFixed(1)} days</b> at the current θ.
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
