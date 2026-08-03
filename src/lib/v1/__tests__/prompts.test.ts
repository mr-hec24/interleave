import { describe, it, expect } from "vitest";
import {
  selectPrompt,
  isSchedulable,
  isPlaceholder,
  type RetrievalPrompt,
} from "../prompts";

function prompt(
  id: string,
  lastServedAt: Date | null,
  timesServed = 0
): RetrievalPrompt {
  return { id, skillId: "s1", text: `cue ${id}`, source: "user", lastServedAt, timesServed };
}

const T = (iso: string) => new Date(iso);
/** Deterministic stand-in for the jitter draw. */
const never = () => 0.99;
const always = () => 0.0;

describe("selectPrompt", () => {
  it("returns null for an empty pool", () => {
    expect(selectPrompt([], never)).toBeNull();
  });

  it("serves never-served prompts before any served one, regardless of jitter", () => {
    const pool = [
      prompt("a", T("2026-01-01T00:00:00Z"), 9),
      prompt("b", null),
      prompt("c", T("2020-01-01T00:00:00Z"), 1),
    ];
    // Even with the jitter draw forced on, a cue with no data must win: it is the
    // only way a new prompt enters the calibration record.
    expect(selectPrompt(pool, always)!.id).toBe("b");
    expect(selectPrompt(pool, never)!.id).toBe("b");
  });

  it("serves the least-recently-served prompt", () => {
    const pool = [
      prompt("recent", T("2026-08-01T00:00:00Z"), 3),
      prompt("stale", T("2026-01-01T00:00:00Z"), 3),
      prompt("middle", T("2026-05-01T00:00:00Z"), 3),
    ];
    expect(selectPrompt(pool, never)!.id).toBe("stale");
  });

  it("is independent of input ordering", () => {
    const a = prompt("a", T("2026-01-01T00:00:00Z"), 3);
    const b = prompt("b", T("2026-05-01T00:00:00Z"), 3);
    const c = prompt("c", T("2026-08-01T00:00:00Z"), 3);
    const orderings = [
      [a, b, c],
      [c, b, a],
      [b, a, c],
    ];
    for (const pool of orderings) {
      expect(selectPrompt(pool, never)!.id).toBe("a");
    }
  });

  it("breaks staleness ties by fewest servings", () => {
    const same = T("2026-01-01T00:00:00Z");
    const pool = [prompt("a", same, 10), prompt("b", same, 2)];
    expect(selectPrompt(pool, never)!.id).toBe("b");
  });

  it("takes the runner-up when the jitter draw fires", () => {
    const pool = [
      prompt("stale", T("2026-01-01T00:00:00Z"), 3),
      prompt("middle", T("2026-05-01T00:00:00Z"), 3),
      prompt("recent", T("2026-08-01T00:00:00Z"), 3),
    ];
    expect(selectPrompt(pool, always)!.id).toBe("middle");
  });

  it("never jitters a single-prompt pool", () => {
    const pool = [prompt("only", T("2026-01-01T00:00:00Z"), 3)];
    expect(selectPrompt(pool, always)!.id).toBe("only");
  });

  it("covers the whole pool under repeated serving", () => {
    // The coverage guarantee is the point of LRU: skill-level stability must
    // reflect the whole cue set, not whichever prompt kept winning a coin flip.
    const pool = [
      prompt("a", null),
      prompt("b", null),
      prompt("c", null),
    ];
    const served = new Set<string>();
    let clock = T("2026-01-01T00:00:00Z").getTime();
    for (let i = 0; i < 9; i++) {
      const chosen = selectPrompt(pool, never)!;
      served.add(chosen.id);
      clock += 60_000;
      chosen.lastServedAt = new Date(clock);
      chosen.timesServed += 1;
    }
    expect(served).toEqual(new Set(["a", "b", "c"]));
    // And roughly evenly — no cue starved.
    for (const p of pool) expect(p.timesServed).toBe(3);
  });

  it("does not mutate the pool it was given", () => {
    const pool = [
      prompt("a", T("2026-01-01T00:00:00Z"), 1),
      prompt("b", T("2026-05-01T00:00:00Z"), 2),
    ];
    const snapshot = JSON.stringify(pool);
    selectPrompt(pool, never);
    expect(JSON.stringify(pool)).toBe(snapshot);
  });
});

describe("isSchedulable — the measurement invariant", () => {
  it("excludes a skill with no live prompts", () => {
    // A skill with no cue has no gradeable retrieval. Scheduling it would produce
    // exactly the undefined-measurement grade this layer exists to prevent.
    expect(isSchedulable(0)).toBe(false);
  });

  it("admits a skill with at least one live prompt", () => {
    expect(isSchedulable(1)).toBe(true);
    expect(isSchedulable(5)).toBe(true);
  });
});

describe("isPlaceholder", () => {
  it("flags migrated cues so analysis can exclude the pre-measurement era", () => {
    const migrated: RetrievalPrompt = { ...prompt("m", null), source: "migrated" };
    const llm: RetrievalPrompt = { ...prompt("l", null), source: "llm" };
    expect(isPlaceholder(migrated)).toBe(true);
    expect(isPlaceholder(llm)).toBe(false);
    expect(isPlaceholder(prompt("u", null))).toBe(false);
  });
});
