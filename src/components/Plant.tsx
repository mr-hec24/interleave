"use client";

export type Health = "strong" | "fading" | "overdue" | "flowering";

interface Props {
  health: Health;
  label: string;
  /** Skill name (defaults to label). */
  name?: string;
  retr?: number;
  days?: number | null;
  interval?: number;
  size?: number;
  showText?: boolean;
  showData?: boolean;
  /** Purely decorative — no text, no a11y label. */
  decorative?: boolean;
  className?: string;
}

// Per-health colors (theme-aware via CSS variables defined on the SVG below).
const HEALTH = {
  strong: { label: "Strong", glyph: "●" }, // ●
  fading: { label: "Fading", glyph: "◑" }, // ◑
  overdue: { label: "Overdue", glyph: "△" }, // △
  flowering: { label: "Flowering", glyph: "✿" }, // ✿
} as const;

// Leaf layouts per state: [anchorX, anchorY, angle°]. Drooping states lean.
const STATES: Record<
  Health,
  { stemTop: number; lean: number; leaves: [number, number, number][] }
> = {
  strong: {
    stemTop: 40,
    lean: 0,
    leaves: [
      [50, 98, -44], [50, 98, 44], [50, 80, -54], [50, 80, 54],
      [50, 62, -40], [50, 62, 40], [50, 48, 0],
    ],
  },
  flowering: {
    stemTop: 42,
    lean: 0,
    leaves: [
      [50, 98, -44], [50, 98, 44], [50, 80, -54], [50, 80, 54],
      [50, 64, -40], [50, 64, 40],
    ],
  },
  fading: {
    stemTop: 54,
    lean: 7,
    leaves: [[50, 100, -72], [50, 100, 74], [50, 82, -82], [50, 82, 84], [50, 68, -64]],
  },
  overdue: {
    stemTop: 68,
    lean: 16,
    leaves: [[50, 104, -116], [50, 100, 120], [50, 88, -126]],
  },
};

export default function Plant({
  health,
  label,
  name,
  retr = 90,
  days = 1,
  interval = 7,
  size = 110,
  showText = true,
  showData = false,
  decorative = false,
  className,
}: Props) {
  const H = HEALTH[health];
  const state = STATES[health];
  const displayName = name ?? label;

  const rx = health === "overdue" ? 13 : 16;
  const ry = 7.5;

  const leaves = state.leaves.map(([ax, ay, ang], i) => {
    const rad = (ang * Math.PI) / 180;
    const cx = ax + Math.sin(rad) * rx;
    const cy = ay - Math.cos(rad) * rx;
    return (
      <ellipse
        key={i}
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill="var(--leaf-fill)"
        stroke="var(--leaf-edge)"
        strokeWidth={1}
        transform={`rotate(${ang - 90} ${cx} ${cy})`}
      />
    );
  });

  let flower = null;
  if (health === "flowering") {
    const fx = 50;
    const fy = state.stemTop - 2;
    const petals = [0, 72, 144, 216, 288].map((a, i) => {
      const r = (a * Math.PI) / 180;
      return (
        <circle
          key={`p${i}`}
          cx={fx + Math.sin(r) * 7}
          cy={fy - Math.cos(r) * 7}
          r={5.5}
          fill="var(--bloom)"
        />
      );
    });
    flower = (
      <g key="fl">
        {petals}
        <circle cx={fx} cy={fy} r={4.5} fill="oklch(0.80 0.11 85)" />
      </g>
    );
  }

  const posture =
    health === "overdue"
      ? "drooping and wilting"
      : health === "fading"
        ? "leaning, leaves thinning"
        : "upright and full";

  const ariaLabel = decorative
    ? undefined
    : `${displayName}. Health: ${H.label}. The plant is ${posture}. Retrievability ${retr} percent, ${days ?? 0} days since last review, current review interval ${interval} days.`;

  // Health → leaf color via CSS vars so light/dark both work.
  const leafVars: Record<Health, { fill: string; edge: string }> = {
    strong: { fill: "var(--green)", edge: "var(--green-deep)" },
    flowering: { fill: "var(--green)", edge: "var(--green-deep)" },
    fading: { fill: "var(--amber)", edge: "var(--amber-ink)" },
    overdue: { fill: "var(--sage)", edge: "var(--sage-ink)" },
  };

  return (
    <div
      role={decorative ? "presentation" : "img"}
      aria-label={ariaLabel}
      className={`inline-flex flex-col items-center gap-1.5 ${className ?? ""}`}
      style={
        {
          "--leaf-fill": leafVars[health].fill,
          "--leaf-edge": leafVars[health].edge,
        } as React.CSSProperties
      }
    >
      <div className="leading-none">
        <svg
          width={size}
          height={Math.round(size * 1.05)}
          viewBox="0 0 100 130"
          aria-hidden="true"
          style={{ display: "block", overflow: "visible" }}
        >
          <g transform={`rotate(${state.lean} 50 130)`}>
            <path
              d={`M50,130 L50,${state.stemTop}`}
              stroke="var(--leaf-edge)"
              strokeWidth={3.2}
              fill="none"
              strokeLinecap="round"
            />
            {leaves}
            {flower}
          </g>
        </svg>
      </div>

      {showText && !decorative && (
        <>
          <div className="flex items-center gap-1.5 max-w-[140px]">
            <span aria-hidden="true" className="text-xs leading-none text-ink-soft">
              {H.glyph}
            </span>
            <span className="text-sm font-semibold text-ink truncate">
              {displayName}
            </span>
          </div>
          <span
            aria-hidden="true"
            className="text-[10px] font-bold tracking-wide uppercase px-2 py-0.5 rounded-full bg-tint text-tint-ink"
          >
            {H.label}
          </span>
          {showData && (
            <span className="font-mono text-[11px] text-ink-soft opacity-70">
              {retr}% · {days ?? 0}d ago · {interval}d
            </span>
          )}
        </>
      )}
    </div>
  );
}
