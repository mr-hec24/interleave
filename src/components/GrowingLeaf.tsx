interface Props {
  /** 0 → 1, how far the practice timer has progressed. */
  progress: number;
  /** True once the timer has fully elapsed — the leaf reaches full bloom. */
  done: boolean;
}

/**
 * A leaf that unfurls along a vine as the practice timer runs, reaching full
 * bloom exactly when the timer ends. The visual reward completes at the switch
 * point — so continuing past the timer earns no further growth, a gentle pull
 * toward switching skills (see research-synthesis.md §4.2).
 */
export default function GrowingLeaf({ progress, done }: Props) {
  const p = Math.min(1, Math.max(0, progress));

  // The vine draws itself in first (0 → 0.35), then the leaf unfurls (0.2 → 1).
  const vineDraw = Math.min(1, p / 0.35);
  const leafGrow = Math.min(1, Math.max(0, (p - 0.2) / 0.8));

  // Leaf scales up and rotates into place as it grows.
  const leafScale = 0.05 + leafGrow * 0.95;
  const leafRotate = -35 + leafGrow * 35;

  // Color deepens from pale spring green to a lush mature green.
  const hue = 95 + leafGrow * 30;
  const sat = 45 + leafGrow * 25;
  const light = 70 - leafGrow * 25;
  const leafColor = done
    ? "hsl(140, 65%, 42%)"
    : `hsl(${hue}, ${sat}%, ${light}%)`;

  const vineLength = 120;

  return (
    <svg
      viewBox="0 0 160 200"
      className="w-40 h-52 mx-auto"
      role="img"
      aria-label={done ? "Leaf fully grown" : "Leaf growing"}
    >
      {/* Soil */}
      <ellipse cx="80" cy="188" rx="42" ry="8" fill="hsl(30, 30%, 78%)" />
      <ellipse cx="80" cy="186" rx="38" ry="6" fill="hsl(28, 35%, 68%)" />

      {/* Vine — draws upward as the timer starts */}
      <path
        d="M80 186 C 80 150, 72 120, 80 80"
        fill="none"
        stroke="hsl(120, 40%, 38%)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={vineLength}
        strokeDashoffset={vineLength * (1 - vineDraw)}
      />

      {/* The growing leaf, anchored near the top of the vine */}
      <g
        transform={`translate(80 84) scale(${leafScale}) rotate(${leafRotate})`}
        style={{ transition: "transform 0.9s ease-out" }}
      >
        <path
          d="M0 0 C 25 -10, 50 -38, 44 -78 C 8 -64, -8 -36, 0 0 Z"
          fill={leafColor}
          style={{ transition: "fill 0.9s ease-out" }}
        />
        {/* Leaf midrib */}
        <path
          d="M2 -4 C 18 -28, 32 -50, 40 -72"
          fill="none"
          stroke="hsl(120, 35%, 30%)"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity={leafGrow * 0.6}
        />
      </g>

      {/* A second small leaf sprouts late, for a fuller look near the end */}
      {leafGrow > 0.55 && (
        <g
          transform={`translate(78 110) scale(${
            (leafGrow - 0.55) / 0.45
          }) rotate(150)`}
          style={{ transition: "transform 0.9s ease-out" }}
        >
          <path
            d="M0 0 C 18 -7, 36 -27, 32 -56 C 6 -46, -6 -26, 0 0 Z"
            fill={leafColor}
            style={{ transition: "fill 0.9s ease-out" }}
          />
        </g>
      )}

      {/* A little bloom when fully grown */}
      {done && (
        <g transform="translate(44 6)">
          {[0, 72, 144, 216, 288].map((angle) => (
            <ellipse
              key={angle}
              cx="0"
              cy="-7"
              rx="4"
              ry="7"
              fill="hsl(48, 90%, 70%)"
              transform={`rotate(${angle})`}
            />
          ))}
          <circle cx="0" cy="0" r="4" fill="hsl(40, 80%, 55%)" />
        </g>
      )}
    </svg>
  );
}
