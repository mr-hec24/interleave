"use client";

import { useState, useId } from "react";

/**
 * Small SVG chart primitives for the model explorer.
 *
 * Hand-rolled rather than pulling in a charting library: these are three specific
 * charts, and a dependency would be more code than the marks themselves.
 *
 * Palette is the validated categorical set, checked against this app's own light
 * (#fdfcf6) and dark (#1a3030) surfaces rather than generic ones. Both modes clear
 * the lightness band, chroma floor, CVD separation, and normal-vision floor. Aqua
 * and yellow sit under 3:1 on the light surface, which is why every series here
 * carries a direct label and every chart offers a table view — identity is never
 * left to colour alone.
 */
export const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500"],
} as const;

export interface Point {
  x: number;
  y: number;
}

interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

const M: Margins = { top: 14, right: 16, bottom: 30, left: 40 };

function scale(v: number, d0: number, d1: number, r0: number, r1: number) {
  if (d1 === d0) return r0;
  return r0 + ((v - d0) / (d1 - d0)) * (r1 - r0);
}

/**
 * Pushes overlapping label positions apart while keeping their original order.
 *
 * Returns positions in the caller's original index order, so labels stay matched to
 * their series — sorting the output would silently reassign every name.
 */
function declutter(ys: number[], minGap: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < order.length; k++) {
    if (order[k].y - order[k - 1].y < minGap) {
      order[k].y = order[k - 1].y + minGap;
    }
  }
  const out = new Array<number>(ys.length);
  for (const { y, i } of order) out[i] = y;
  return out;
}

export function TableToggle({
  open,
  onToggle,
  label = "data",
}: {
  open: boolean;
  onToggle: () => void;
  label?: string;
}) {
  return (
    <button
      onClick={onToggle}
      className="text-[11px] text-ink-mute hover:text-ink underline underline-offset-2"
      aria-expanded={open}
    >
      {open ? "Hide" : "Show"} {label}
    </button>
  );
}

export interface ReviewMark {
  x: number;
  y: number;
  grade: string;
  lapse: boolean;
}

/**
 * Retrievability over time, with review events marked.
 *
 * One series, so no legend box — the title names it. Reviews are rendered as
 * markers rather than a second series because they are events on the same measure,
 * not a competing one.
 */
export function DecayChart({
  points,
  reviews,
  theta,
  width = 700,
  height = 250,
  dark,
}: {
  points: Point[];
  reviews: ReviewMark[];
  theta: number;
  width?: number;
  height?: number;
  dark: boolean;
}) {
  const [hover, setHover] = useState<Point | null>(null);
  const [showTable, setShowTable] = useState(false);
  const clipId = useId();

  const xMax = points.length > 0 ? points[points.length - 1].x : 1;
  const px = (x: number) => scale(x, 0, xMax, M.left, width - M.right);
  const py = (y: number) => scale(y, 0, 1, height - M.bottom, M.top);

  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x).toFixed(1)},${py(p.y).toFixed(1)}`)
    .join(" ");

  const line = dark ? SERIES.dark[0] : SERIES.light[0];
  const lapseColor = dark ? SERIES.dark[1] : SERIES.light[1];

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const rx = ((e.clientX - rect.left) / rect.width) * width;
    const day = Math.round(scale(rx, M.left, width - M.right, 0, xMax));
    const p = points.find((q) => q.x === day) ?? null;
    setHover(p);
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label="Retrievability over time, with review events"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={M.left} y={M.top} width={width - M.left - M.right} height={height - M.top - M.bottom} />
          </clipPath>
        </defs>

        {/* Gridlines — recessive hairlines, never competing with the data */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={width - M.right}
              y1={py(t)}
              y2={py(t)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={M.left - 8}
              y={py(t) + 3.5}
              textAnchor="end"
              className="fill-[var(--ink-mute)]"
              style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}
            >
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}

        {/* The target band: where the scheduler wants retrieval to happen */}
        <line
          x1={M.left}
          x2={width - M.right}
          y1={py(theta)}
          y2={py(theta)}
          stroke="var(--clay)"
          strokeWidth={2}
          strokeDasharray="5 4"
        />
        <text
          x={width - M.right}
          y={py(theta) - 6}
          textAnchor="end"
          className="fill-[var(--clay)]"
          style={{ fontSize: 10, fontWeight: 600 }}
        >
          θ target {Math.round(theta * 100)}%
        </text>

        <g clipPath={`url(#${clipId})`}>
          <path d={path} fill="none" stroke={line} strokeWidth={2} strokeLinejoin="round" />

          {reviews.map((r, i) => (
            <circle
              key={i}
              cx={px(r.x)}
              cy={py(r.y)}
              r={4.5}
              fill={r.lapse ? lapseColor : line}
              stroke="var(--surface)"
              strokeWidth={2}
            />
          ))}
        </g>

        {hover && (
          <g pointerEvents="none">
            <line
              x1={px(hover.x)}
              x2={px(hover.x)}
              y1={M.top}
              y2={height - M.bottom}
              stroke="var(--ink-mute)"
              strokeWidth={1}
            />
            <circle cx={px(hover.x)} cy={py(hover.y)} r={4} fill={line} stroke="var(--surface)" strokeWidth={2} />
            <g transform={`translate(${Math.min(px(hover.x) + 8, width - 116)},${M.top + 4})`}>
              <rect width={108} height={34} rx={6} fill="var(--surface)" stroke="var(--border-strong)" />
              <text x={8} y={14} className="fill-[var(--ink-soft)]" style={{ fontSize: 10 }}>
                day {hover.x}
              </text>
              <text
                x={8}
                y={27}
                className="fill-[var(--ink)]"
                style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
              >
                recall {Math.round(hover.y * 100)}%
              </text>
            </g>
          </g>
        )}

        {/* x axis */}
        <line
          x1={M.left}
          x2={width - M.right}
          y1={height - M.bottom}
          y2={height - M.bottom}
          stroke="var(--border-strong)"
          strokeWidth={1}
        />
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <text
            key={f}
            x={px(f * xMax)}
            y={height - M.bottom + 15}
            textAnchor="middle"
            className="fill-[var(--ink-mute)]"
            style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}
          >
            {Math.round(f * xMax)}d
          </text>
        ))}
      </svg>

      <div className="flex justify-end mt-1">
        <TableToggle open={showTable} onToggle={() => setShowTable((o) => !o)} label="review table" />
      </div>

      {showTable && (
        <div className="mt-2 max-h-52 overflow-y-auto border border-edge rounded-lg">
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-surface-2">
              <tr className="text-ink-mute">
                <th className="text-left px-3 py-1.5 font-semibold">#</th>
                <th className="text-left px-3 py-1.5 font-semibold">Day</th>
                <th className="text-left px-3 py-1.5 font-semibold">Recall at review</th>
                <th className="text-left px-3 py-1.5 font-semibold">Outcome</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {reviews.map((r, i) => (
                <tr key={i} className="border-t border-edge">
                  <td className="px-3 py-1 text-ink-mute">{i + 1}</td>
                  <td className="px-3 py-1 text-ink">{r.x}</td>
                  <td className="px-3 py-1 text-ink">{Math.round(r.y * 100)}%</td>
                  <td className={`px-3 py-1 font-medium ${r.lapse ? "text-clay" : "text-green-deep"}`}>
                    {r.grade}
                  </td>
                </tr>
              ))}
              {reviews.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-2 text-ink-mute">
                    No reviews in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export interface UtilityTerm {
  label: string;
  raw: number;
  weighted: number;
  sign: 1 | -1;
}

/**
 * The four utility terms as a signed bar chart, with the ε threshold marked.
 *
 * Diverging around zero because the terms genuinely have polarity — two add, two
 * subtract — and stacking them would hide that. Every bar is directly labelled, so
 * the light-surface contrast warning on the aqua and yellow slots never has to
 * carry meaning alone.
 */
export function UtilityChart({
  terms,
  total,
  epsilon,
  width = 700,
  height = 210,
  dark,
}: {
  terms: UtilityTerm[];
  total: number;
  epsilon: number;
  width?: number;
  height?: number;
  dark: boolean;
}) {
  const [showTable, setShowTable] = useState(false);
  const palette = dark ? SERIES.dark : SERIES.light;

  // Word labels on the left and value labels on both bar ends need far more room
  // than the numeric tick margin the line charts use.
  const ML = 92;
  const MR = 54;

  const extent = Math.max(1, ...terms.map((t) => Math.abs(t.weighted)), Math.abs(total));
  const mid = ML + (width - ML - MR) / 2;
  const halfW = (width - ML - MR) / 2;
  const bx = (v: number) => mid + (v / extent) * halfW;

  const rows = [...terms, { label: "Utility", raw: total, weighted: total, sign: 1 as const }];
  const rowH = (height - M.top - M.bottom) / rows.length;

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label="Utility decomposition"
      >
        {/* zero line */}
        <line x1={mid} x2={mid} y1={M.top} y2={height - M.bottom} stroke="var(--border-strong)" strokeWidth={1} />

        {/* the switching margin */}
        <line
          x1={bx(epsilon)}
          x2={bx(epsilon)}
          y1={M.top}
          y2={height - M.bottom}
          stroke="var(--clay)"
          strokeWidth={2}
          strokeDasharray="5 4"
        />
        <text
          x={bx(epsilon) + 5}
          y={height - M.bottom + 14}
          className="fill-[var(--clay)]"
          style={{ fontSize: 10, fontWeight: 600 }}
        >
          ε {epsilon.toFixed(2)}
        </text>

        {rows.map((t, i) => {
          const isTotal = t.label === "Utility";
          const y = M.top + i * rowH + rowH * 0.22;
          const h = rowH * 0.5;
          const v = t.weighted;
          const x0 = Math.min(mid, bx(v));
          const w = Math.abs(bx(v) - mid);
          const fill = isTotal ? "var(--ink-soft)" : palette[i % palette.length];
          return (
            <g key={t.label}>
              <text
                x={ML - 10}
                y={y + h / 2 + 3.5}
                textAnchor="end"
                className={isTotal ? "fill-[var(--ink)]" : "fill-[var(--ink-soft)]"}
                style={{ fontSize: 10, fontWeight: isTotal ? 700 : 500 }}
              >
                {t.label}
              </text>
              <rect x={x0} y={y} width={Math.max(w, 1)} height={h} rx={3} fill={fill} />
              <text
                x={v >= 0 ? bx(v) + 6 : bx(v) - 6}
                y={y + h / 2 + 3.5}
                textAnchor={v >= 0 ? "start" : "end"}
                className="fill-[var(--ink)]"
                style={{ fontSize: 10, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}
              >
                {v >= 0 ? "+" : "−"}
                {Math.abs(v).toFixed(2)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flex justify-end mt-1">
        <TableToggle open={showTable} onToggle={() => setShowTable((o) => !o)} />
      </div>

      {showTable && (
        <table className="w-full text-[11px] mt-2 border border-edge rounded-lg overflow-hidden">
          <thead className="bg-surface-2 text-ink-mute">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold">Term</th>
              <th className="text-left px-3 py-1.5 font-semibold">Raw</th>
              <th className="text-left px-3 py-1.5 font-semibold">Weighted</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {terms.map((t) => (
              <tr key={t.label} className="border-t border-edge">
                <td className="px-3 py-1 text-ink">{t.label}</td>
                <td className="px-3 py-1 text-ink-soft">{t.raw.toFixed(3)}</td>
                <td className="px-3 py-1 text-ink">
                  {t.weighted >= 0 ? "+" : "−"}
                  {Math.abs(t.weighted).toFixed(3)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-edge font-semibold">
              <td className="px-3 py-1 text-ink">Utility</td>
              <td className="px-3 py-1" />
              <td className="px-3 py-1 text-ink">{total.toFixed(3)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Channel saturation over a session. Four series, so a legend is present AND each
 * line is directly labelled at its end — belt and braces for the two slots that
 * fall under 3:1 on the light surface.
 */
export function FatigueChart({
  series,
  labels,
  minutes,
  blockEnd,
  width = 700,
  height = 230,
  dark,
}: {
  series: number[][];
  labels: string[];
  minutes: number;
  blockEnd: number;
  width?: number;
  height?: number;
  dark: boolean;
}) {
  const [showTable, setShowTable] = useState(false);
  const palette = dark ? SERIES.dark : SERIES.light;
  const right = width - M.right - 46;
  const px = (x: number) => scale(x, 0, minutes, M.left, right);
  const py = (y: number) => scale(y, 0, 1, height - M.bottom, M.top);

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" role="img" aria-label="Channel saturation over a session">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={M.left} x2={right} y1={py(t)} y2={py(t)} stroke="var(--border)" strokeWidth={1} />
            <text
              x={M.left - 8}
              y={py(t) + 3.5}
              textAnchor="end"
              className="fill-[var(--ink-mute)]"
              style={{ fontSize: 10 }}
            >
              {Math.round(t * 100)}%
            </text>
          </g>
        ))}

        {/* where practice stops and recovery begins */}
        <line x1={px(blockEnd)} x2={px(blockEnd)} y1={M.top} y2={height - M.bottom} stroke="var(--border-strong)" strokeWidth={1} strokeDasharray="4 4" />
        <text x={px(blockEnd) + 5} y={M.top + 10} className="fill-[var(--ink-mute)]" style={{ fontSize: 9 }}>
          practice ends
        </text>

        {series.map((s, i) => {
          const d = s
            .map((v, x) => `${x === 0 ? "M" : "L"}${px(x).toFixed(1)},${py(v).toFixed(1)}`)
            .join(" ");
          return (
            <path
              key={labels[i]}
              d={d}
              fill="none"
              stroke={palette[i]}
              strokeWidth={2}
              strokeLinejoin="round"
            />
          );
        })}

        {/* Direct labels, nudged apart where lines converge. Channels a skill
            barely loads all end near zero, so without this they overprint into an
            unreadable smudge — and these labels are the relief for the two slots
            that sit under 3:1 on the light surface. */}
        {declutter(series.map((s) => py(s[s.length - 1])), 10).map((y, i) => (
          <text
            key={labels[i]}
            x={right + 6}
            y={y + 3.5}
            className="fill-[var(--ink-soft)]"
            style={{ fontSize: 9, fontWeight: 600 }}
          >
            {labels[i]}
          </text>
        ))}

        <line x1={M.left} x2={right} y1={height - M.bottom} y2={height - M.bottom} stroke="var(--border-strong)" strokeWidth={1} />
        {[0, 0.5, 1].map((f) => (
          <text
            key={f}
            x={px(f * minutes)}
            y={height - M.bottom + 15}
            // The last tick anchors end-ways so it doesn't run under the direct
            // labels sitting just past the plot edge.
            textAnchor={f === 0 ? "start" : f === 1 ? "end" : "middle"}
            className="fill-[var(--ink-mute)]"
            style={{ fontSize: 10 }}
          >
            {Math.round(f * minutes)}m
          </text>
        ))}
      </svg>

      <div className="flex items-center justify-between mt-1">
        <div className="flex gap-3 flex-wrap">
          {labels.map((l, i) => (
            <span key={l} className="flex items-center gap-1.5 text-[10px] text-ink-soft">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: palette[i] }} />
              {l}
            </span>
          ))}
        </div>
        <TableToggle open={showTable} onToggle={() => setShowTable((o) => !o)} />
      </div>

      {showTable && (
        <table className="w-full text-[11px] mt-2 border border-edge rounded-lg overflow-hidden">
          <thead className="bg-surface-2 text-ink-mute">
            <tr>
              <th className="text-left px-3 py-1.5 font-semibold">Minute</th>
              {labels.map((l) => (
                <th key={l} className="text-left px-3 py-1.5 font-semibold">
                  {l}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {[0, 0.25, 0.5, 0.75, 1].map((f) => {
              const x = Math.round(f * (series[0].length - 1));
              return (
                <tr key={f} className="border-t border-edge">
                  <td className="px-3 py-1 text-ink-soft">{x}</td>
                  {series.map((s, i) => (
                    <td key={i} className="px-3 py-1 text-ink">
                      {Math.round(s[x] * 100)}%
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function Slider({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
  format = (v: number) => v.toFixed(2),
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[11px] font-semibold text-ink">
          {label}
        </label>
        <span className="font-mono text-[11px] text-ink-soft tabular-nums">{format(value)}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--green)] mt-1"
      />
      {hint && <p className="text-[10px] text-ink-mute leading-snug mt-0.5">{hint}</p>}
    </div>
  );
}
