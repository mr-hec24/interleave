interface Props {
  /** 0 → 1, how far the practice timer has progressed. */
  progress: number;
  /** True once the timer has fully elapsed — a bloom appears. */
  done: boolean;
  size?: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// Final-frame side-leaf geometry [cx, cy, rx, ry, rotation]. Each leaf emerges
// as the rising stem passes its height, then scales up to full — so the plant
// genuinely grows tier by tier rather than stretching a finished image.
const SIDE_LEAVES: [number, number, number, number, number][] = [
  [38.5, 86.5, 17, 7.5, -134],
  [61.5, 86.5, 17, 7.5, -46],
  [36.8, 67.5, 16, 7, -142],
  [63.2, 67.5, 16, 7, -38],
  [39, 49, 14.5, 6.5, -130],
  [61, 49, 14.5, 6.5, -50],
];

/**
 * A single leaf growing inside the practice ring. Driven entirely by `progress`
 * (re-rendered each tick), so it naturally shows the correct frame for the
 * current progress — which is exactly the "Reduce Motion" fallback the design
 * calls for. No CSS keyframe stretching.
 */
export default function GrowingTimerLeaf({ progress, done, size = 120 }: Props) {
  const p = clamp01(progress);

  // Stem rises from y≈120 (just planted) to y=38 (fully grown) as p → 1.
  const stemTop = 120 - 82 * p;

  // Terminal bud grows with overall progress.
  const tsc = clamp01(p / 0.9);
  const tRx = 4 + 9.5 * tsc;
  const tRy = 6 + 17 * tsc;

  return (
    <svg
      width={size}
      height={Math.round(size * 1.05)}
      viewBox="0 0 100 130"
      aria-hidden="true"
      style={{ display: "block", overflow: "visible" }}
    >
      {/* Soil mound */}
      <ellipse cx="50" cy="124" rx="22" ry="5" fill="var(--clay)" style={{ filter: "brightness(0.85)" }} />

      {/* Stem */}
      <path
        d={`M50,124 L50,${stemTop}`}
        stroke="var(--green-deep)"
        strokeWidth={4}
        strokeLinecap="round"
      />

      {/* Side leaves — emerge as the stem passes each one */}
      {SIDE_LEAVES.map(([cx, cy, rx, ry, rot], i) => {
        // Leaf scales in once the stem top has risen past its height.
        const sc = clamp01((cy - stemTop) / 16);
        if (sc <= 0) return null;
        return (
          <ellipse
            key={i}
            cx={cx}
            cy={cy}
            rx={rx * sc}
            ry={ry * sc}
            fill="var(--green)"
            transform={`rotate(${rot} ${cx} ${cy})`}
          />
        );
      })}

      {/* Terminal bud, or bloom on completion */}
      {done ? (
        <g>
          {[0, 72, 144, 216, 288].map((a, i) => {
            const r = (a * Math.PI) / 180;
            return (
              <circle
                key={i}
                cx={50 + Math.sin(r) * 11}
                cy={stemTop + 2 - Math.cos(r) * 11}
                r={9}
                fill="var(--bloom)"
              />
            );
          })}
          <circle cx={50} cy={stemTop + 2} r={7.5} fill="oklch(0.80 0.11 85)" />
        </g>
      ) : (
        tsc > 0 && (
          <ellipse cx={50} cy={stemTop} rx={tRx} ry={tRy} fill="var(--green)" />
        )
      )}
    </svg>
  );
}
