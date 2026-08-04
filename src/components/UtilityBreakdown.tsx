"use client";

import type { RankedSkill } from "@/lib/v1/controller";
import type { SkillMeta } from "./Dashboard";
import { retrPct } from "@/lib/health";

interface Props {
  rec: RankedSkill;
  epsilon: number;
  meta?: SkillMeta;
  reason: string;
  interferenceSourceName: string | null;
  onPractise: () => void;
  onEditCues: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

/**
 * One row of the §7 audit surface.
 *
 * The design's trust argument is that a learner asked to override their own
 * instincts deserves to see why the algorithm disagrees. A single utility number
 * doesn't do that — it says "trust me" in decimal. So each of the four terms is
 * shown separately, signed and to scale, and the components rendered here are the
 * same object written to `events.u_vector`, which is what keeps the explanation and
 * the decision from drifting apart.
 */
export default function UtilityBreakdown({
  rec,
  epsilon,
  meta,
  reason,
  interferenceSourceName,
  onPractise,
  onEditCues,
  onEdit,
  onRemove,
}: Props) {
  // Bars are scaled against the largest term present so small differences stay
  // legible; the printed numbers are the real ones.
  const terms = [
    { key: "urgency", label: "Urgency", value: rec.urgency, sign: 1 },
    { key: "fatigue", label: "Fatigue", value: rec.fatigue, sign: -1 },
    { key: "readiness", label: "Readiness", value: rec.readiness, sign: 1 },
    { key: "interference", label: "Interference", value: rec.interference, sign: -1 },
  ] as const;
  const scale = Math.max(...terms.map((t) => t.value), 0.001);

  const aboveMargin = rec.utility >= epsilon;

  return (
    <div className="bg-surface border border-edge rounded-xl p-4">
      <div className="flex items-center gap-2.5">
        <span className="font-semibold text-sm text-ink flex-1 min-w-0 truncate">
          {rec.skillName}
        </span>
        <span
          className={`font-mono text-xs tabular-nums ${
            aboveMargin ? "text-green-deep font-semibold" : "text-ink-mute"
          }`}
          title={`Utility ${rec.utility.toFixed(3)}; the margin to interrupt is ${epsilon}`}
        >
          U {rec.utility.toFixed(2)}
        </span>
      </div>

      <p className="text-xs text-ink-soft mt-1.5 leading-relaxed">{reason}</p>

      <div className="mt-3 flex flex-col gap-1">
        {terms.map((t) => (
          <div key={t.key} className="flex items-center gap-2">
            <span className="text-[10px] text-ink-mute w-[72px] flex-shrink-0">
              {t.label}
            </span>
            <div className="flex-1 h-[6px] bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.min(100, (t.value / scale) * 100)}%`,
                  background: t.sign > 0 ? "var(--green)" : "var(--clay)",
                }}
              />
            </div>
            <span className="font-mono text-[10px] text-ink-mute w-[46px] text-right tabular-nums">
              {t.sign > 0 ? "+" : "−"}
              {t.value.toFixed(2)}
            </span>
          </div>
        ))}
      </div>

      {interferenceSourceName && rec.interference > 0 && (
        <p className="text-[11px] text-clay mt-2">
          Interference from {interferenceSourceName}.
        </p>
      )}

      <div className="flex items-center gap-4 mt-3 flex-wrap">
        <div className="flex gap-3 font-mono text-[10px] text-ink-mute tabular-nums">
          <span title="Predicted probability of successful recall right now">
            R {retrPct(rec)}%
          </span>
          {meta?.stability != null && (
            <span title="Days until recall decays to 90%">
              S {meta.stability < 10 ? meta.stability.toFixed(1) : Math.round(meta.stability)}d
            </span>
          )}
          {meta && (
            <span title="Retrieval cues in this skill's pool">
              {meta.promptPoolSize} cue{meta.promptPoolSize === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="ml-auto flex gap-3 text-[11px]">
          <button
            onClick={onPractise}
            className="text-green-deep hover:underline font-medium"
          >
            Practise
          </button>
          <button onClick={onEditCues} className="text-ink-mute hover:text-ink">
            Cues
          </button>
          <button onClick={onEdit} className="text-ink-mute hover:text-ink">
            Edit
          </button>
          <button onClick={onRemove} className="text-ink-mute hover:text-red-600">
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
