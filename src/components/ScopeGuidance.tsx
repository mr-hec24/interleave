interface Props {
  variant: "skill" | "session";
}

/**
 * Explains what makes a well-scoped skill (or session) versus one that is too
 * broad to schedule meaningfully. A skill must be narrow enough that a single
 * 0–5 recall rating is a coherent signal — "Guitar" cannot be rated as one
 * thing, but "Blues scale in A" can. This keeps the SM-2 / scheduler math
 * honest: each skill needs its own well-defined forgetting curve.
 */
export default function ScopeGuidance({ variant }: Props) {
  return (
    <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-900 space-y-1.5">
      {variant === "skill" ? (
        <>
          <p className="font-medium">
            Keep skills narrow and concrete.
          </p>
          <p>
            A good skill is small enough that one recall rating (0–5) describes
            it. If you can&apos;t rate &quot;how well do I remember this?&quot; in
            one number, it&apos;s too broad — split it up.
          </p>
          <ul className="space-y-0.5 pl-0.5">
            <li>
              <span className="text-red-700">✗ Guitar</span> →{" "}
              <span className="text-green-700">✓ Blues scale in A</span>,{" "}
              <span className="text-green-700">✓ Travis picking pattern</span>
            </li>
            <li>
              <span className="text-red-700">✗ French</span> →{" "}
              <span className="text-green-700">✓ Passé composé conjugation</span>
              , <span className="text-green-700">✓ Numbers 1–100</span>
            </li>
            <li>
              <span className="text-red-700">✗ Machine learning</span> →{" "}
              <span className="text-green-700">✓ Backprop derivation</span>,{" "}
              <span className="text-green-700">✓ Bias–variance tradeoff</span>
            </li>
          </ul>
          <p className="text-amber-700">
            Broad goals like &quot;learn guitar&quot; aren&apos;t skills — they&apos;re
            collections of them. The scheduler needs a single forgetting curve
            per skill to know when to bring it back.
          </p>
        </>
      ) : (
        <>
          <p className="font-medium">What counts as a session?</p>
          <p>
            A session is one focused retrieval attempt at this specific skill —
            you tried to recall or perform it, then rate how it went. The rating
            is about <em>this skill</em>, not your whole practice block.
          </p>
          <ul className="space-y-0.5 pl-0.5">
            <li>
              <span className="text-green-700">✓</span> Played the A blues scale
              from memory, rated the recall
            </li>
            <li>
              <span className="text-green-700">✓</span> Recalled passé composé
              endings before drilling them
            </li>
            <li>
              <span className="text-red-700">✗</span> &quot;Practiced guitar for an
              hour&quot; — too broad, mixes many skills
            </li>
            <li>
              <span className="text-red-700">✗</span> Passive review (watched a
              video) with no recall attempt
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
