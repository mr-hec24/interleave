"use client";

import { useState } from "react";
import Plant from "./Plant";

const STEPS = ["welcome", "science", "planter", "skill", "done"] as const;
type Step = (typeof STEPS)[number];

interface Props {
  onComplete: (opts: { topicName: string; skillName: string }) => void;
}

const DOT_STEPS: Step[] = ["welcome", "science", "planter", "skill", "done"];

function StepDots({ current }: { current: Step }) {
  return (
    <div className="flex items-center justify-center gap-1.5" aria-hidden="true">
      {DOT_STEPS.map((s) => (
        <span
          key={s}
          className={`rounded-full transition-all ${
            s === current ? "w-5 h-1.5 bg-green" : "w-1.5 h-1.5 bg-edge"
          }`}
        />
      ))}
    </div>
  );
}

export default function OnboardingModal({ onComplete }: Props) {
  const [step, setStep] = useState<Step>("welcome");
  const [topicName, setTopicName] = useState("");
  const [skillName, setSkillName] = useState("");

  function next() {
    const idx = STEPS.indexOf(step);
    if (idx < STEPS.length - 1) setStep(STEPS[idx + 1]);
  }

  function finish() {
    onComplete({ topicName: topicName.trim(), skillName: skillName.trim() });
  }

  const inputCls =
    "w-full box-border text-[15px] font-medium text-ink bg-surface border border-edge rounded-xl px-3.5 py-3 placeholder-ink-mute focus:outline-none focus:border-green focus:ring-2 focus:ring-green/40";
  const labelCls = "block text-[10px] font-bold tracking-[0.08em] uppercase text-ink-mute mb-1.5";

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div
        className="bg-surface rounded-2xl w-full max-w-lg shadow-xl border border-edge overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="Welcome to Interleaf"
      >
        {/* Progress bar */}
        <div className="h-1 bg-edge">
          <div
            className="h-full bg-green transition-all duration-500"
            style={{ width: `${((STEPS.indexOf(step) + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        <div className="p-8 pb-7">
          {step === "welcome" && (
            <div className="flex flex-col items-center text-center gap-5">
              <div className="flex gap-2 items-end">
                <Plant health="fading" label="" decorative size={56} showText={false} />
                <Plant health="strong" label="" decorative size={72} showText={false} />
                <Plant health="flowering" label="" decorative size={60} showText={false} />
              </div>
              <div>
                <div className="font-display font-semibold text-[28px] text-ink leading-tight">
                  Welcome to your garden.
                </div>
                <p className="text-sm text-ink-soft mt-2 leading-relaxed max-w-sm mx-auto">
                  Interleaf helps you practice multiple skills — music, language, code, anything
                  — and tells you exactly what to tend next, and for how long.
                </p>
              </div>
              <p className="text-sm text-ink-soft leading-relaxed max-w-sm mx-auto">
                Think of each skill as a plant. You water them on a schedule, and they grow.
                Interleaf watches the whole garden and reminds you which plant needs water before
                it wilts.
              </p>
              <button
                onClick={next}
                className="w-full font-semibold text-on-green bg-green-btn rounded-xl py-3.5 mt-1"
              >
                Tell me more →
              </button>
            </div>
          )}

          {step === "science" && (
            <div className="flex flex-col gap-5">
              <div className="font-display font-semibold text-[24px] text-ink leading-tight">
                Why this actually works.
              </div>
              <div className="space-y-4">
                {[
                  {
                    icon: "🌱",
                    title: "Spacing beats cramming",
                    body: "Reviewing a skill right before you forget it forces your brain to work harder to retrieve it — and that effort is what makes the memory stick. Interleaf spaces your reviews at exactly that moment.",
                  },
                  {
                    icon: "🔀",
                    title: "Switching is the point",
                    body: "Interleaving — jumping between skills rather than grinding one — feels harder but produces stronger long-term memory. The discomfort is the learning.",
                  },
                  {
                    icon: "📊",
                    title: "Your rating drives the math",
                    body: "After each practice, you rate how well it came back (0–5). Interleaf uses that rating to calculate exactly how many days until you'll need to see it again — no guessing.",
                  },
                ].map(({ icon, title, body }) => (
                  <div key={title} className="flex gap-3">
                    <span className="text-xl mt-0.5 flex-shrink-0">{icon}</span>
                    <div>
                      <div className="font-semibold text-sm text-ink">{title}</div>
                      <p className="text-sm text-ink-soft leading-relaxed mt-0.5">{body}</p>
                    </div>
                  </div>
                ))}
              </div>
              <button
                onClick={next}
                className="w-full font-semibold text-on-green bg-green-btn rounded-xl py-3.5 mt-1"
              >
                Got it — let's plant →
              </button>
            </div>
          )}

          {step === "planter" && (
            <div className="flex flex-col gap-5">
              <div>
                <div className="font-display font-semibold text-[24px] text-ink leading-tight">
                  First, create a planter.
                </div>
                <p className="text-sm text-ink-soft mt-1.5 leading-relaxed">
                  A planter is a subject area — like "Guitar" or "Spanish" or "Machine Learning."
                  Skills (the specific things you practice) live inside planters.
                </p>
              </div>
              <div className="bg-tint border border-tint-border rounded-xl px-3.5 py-3 text-xs text-ink-soft">
                <span className="font-semibold text-ink">Tip:</span> Planters can be broad —
                "French" is a great planter. The specific thing you practice (&quot;Passé composé
                endings&quot;) becomes a skill inside it.
              </div>
              <div>
                <label className={labelCls} htmlFor="ob-topic">
                  Planter name
                </label>
                <input
                  id="ob-topic"
                  type="text"
                  placeholder="e.g. Spanish, Guitar, Machine Learning"
                  value={topicName}
                  onChange={(e) => setTopicName(e.target.value)}
                  className={inputCls}
                  autoFocus
                />
              </div>
              <button
                onClick={next}
                disabled={!topicName.trim()}
                className="w-full font-semibold text-on-green bg-green-btn rounded-xl py-3.5 disabled:opacity-40"
              >
                Plant it →
              </button>
            </div>
          )}

          {step === "skill" && (
            <div className="flex flex-col gap-5">
              <div>
                <div className="font-display font-semibold text-[24px] text-ink leading-tight">
                  Now, your first skill.
                </div>
                <p className="text-sm text-ink-soft mt-1.5 leading-relaxed">
                  A skill is narrow and concrete — specific enough that you can answer
                  &quot;how well do I remember this?&quot; with a single number.
                </p>
              </div>
              <div className="bg-tint border border-tint-border rounded-xl px-3.5 py-3 text-xs text-ink-soft space-y-1">
                <p>
                  <span className="text-red-600 font-medium">Too broad:</span>{" "}
                  {topicName || "your topic"} in general
                </p>
                <p>
                  <span className="text-green-deep font-medium">Just right:</span>{" "}
                  one specific concept, technique, or piece you can test yourself on
                </p>
              </div>
              <div>
                <label className={labelCls} htmlFor="ob-skill">
                  Skill name
                </label>
                <input
                  id="ob-skill"
                  type="text"
                  placeholder="e.g. Passé composé endings, Blues scale in A"
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                  className={inputCls}
                  autoFocus
                />
              </div>
              <button
                onClick={next}
                disabled={!skillName.trim()}
                className="w-full font-semibold text-on-green bg-green-btn rounded-xl py-3.5 disabled:opacity-40"
              >
                Add to garden →
              </button>
            </div>
          )}

          {step === "done" && (
            <div className="flex flex-col items-center text-center gap-5">
              <div className="flex gap-2 items-end">
                <Plant health="fading" label="" decorative size={64} showText={false} />
                <Plant health="flowering" label="" decorative size={80} showText={false} />
                <Plant health="strong" label="" decorative size={56} showText={false} />
              </div>
              <div>
                <div className="font-display font-semibold text-[26px] text-ink leading-tight">
                  Your garden is planted.
                </div>
                <p className="text-sm text-ink-soft mt-2 leading-relaxed max-w-sm mx-auto">
                  <span className="font-semibold text-ink">{skillName}</span> is your first plant.
                  Practice it now, rate how it went, and Interleaf will tell you exactly when to
                  come back.
                </p>
              </div>
              <div className="w-full space-y-2 text-left">
                {[
                  "Practice when Interleaf asks — it picks the right moment",
                  "Rate honestly after each session — the math depends on it",
                  "Add more skills to interleave between them",
                ].map((t) => (
                  <div key={t} className="flex items-start gap-2 text-sm text-ink-soft">
                    <span className="text-green-deep font-bold mt-0.5">✓</span>
                    {t}
                  </div>
                ))}
              </div>
              <button
                onClick={finish}
                className="w-full font-semibold text-on-green bg-green-btn rounded-xl py-3.5 mt-1"
              >
                Open my garden →
              </button>
            </div>
          )}

          <div className="mt-6">
            <StepDots current={step} />
          </div>
        </div>
      </div>
    </div>
  );
}
