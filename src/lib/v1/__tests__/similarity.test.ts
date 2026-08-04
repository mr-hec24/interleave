import { describe, it, expect } from "vitest";
import {
  buildSimilarityEdges,
  buildSimilarityGraph,
  similarityTo,
  DEFAULT_SIMILARITY_OPTIONS,
} from "../similarity";
import {
  interference,
  interferenceSource,
  type RecentPractice,
} from "../interference";
import { cosineSimilarity, normalise, skillEmbeddingText } from "../embeddings/provider";
import { LexicalEmbeddingProvider } from "../embeddings/lexical";

/** Builds a unit vector in 3-space, for exact control over similarity values. */
const vec = (...xs: number[]) => normalise(Float32Array.from(xs));

describe("cosineSimilarity", () => {
  it("is 1 for identical, 0 for orthogonal, -1 for opposed", () => {
    expect(cosineSimilarity(vec(1, 0, 0), vec(1, 0, 0))).toBeCloseTo(1, 10);
    expect(cosineSimilarity(vec(1, 0, 0), vec(0, 1, 0))).toBeCloseTo(0, 10);
    expect(cosineSimilarity(vec(1, 0, 0), vec(-1, 0, 0))).toBeCloseTo(-1, 10);
  });

  it("never exceeds 1, even for an exact pair", () => {
    // Floating-point drift past 1 would trip the `sim <= 1` database constraint on
    // an edge that is simply exact.
    const v = normalise(Float32Array.from([0.3, 0.9, 0.31, 0.0007]));
    expect(cosineSimilarity(v, v)).toBeLessThanOrEqual(1);
  });

  it("returns 0 rather than NaN for a zero vector", () => {
    const zero = Float32Array.from([0, 0, 0]);
    expect(cosineSimilarity(zero, vec(1, 0, 0))).toBe(0);
  });

  it("throws on a dimension mismatch instead of silently comparing", () => {
    expect(() => cosineSimilarity(vec(1, 0, 0), vec(1, 0))).toThrow(/dimension/i);
  });
});

describe("buildSimilarityEdges", () => {
  const s = (id: string, ...xs: number[]) => ({ id, embedding: vec(...xs) });

  it("keeps only pairs above the threshold", () => {
    const edges = buildSimilarityEdges(
      [s("a", 1, 0, 0), s("b", 0.98, 0.2, 0), s("c", 0, 0, 1)],
      DEFAULT_SIMILARITY_OPTIONS
    );
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ skillA: "a", skillB: "b" });
    expect(edges[0].sim).toBeGreaterThan(0.6);
  });

  it("stores each undirected pair once, canonically ordered", () => {
    const edges = buildSimilarityEdges([s("z", 1, 0, 0), s("a", 1, 0, 0)]);
    expect(edges).toHaveLength(1);
    expect(edges[0].skillA).toBe("a");
    expect(edges[0].skillB).toBe("z");
  });

  it("produces no self-edges", () => {
    const edges = buildSimilarityEdges([s("a", 1, 0, 0), s("b", 1, 0, 0)]);
    for (const e of edges) expect(e.skillA).not.toBe(e.skillB);
  });

  it("enforces the degree cap symmetrically", () => {
    // A hub connected to everything would be penalised whenever anything was
    // practised, and would drop out of the rotation entirely.
    const skills = [s("hub", 1, 0, 0)];
    for (let i = 0; i < 20; i++) skills.push(s(`leaf${i}`, 1, 0.01 * i, 0));

    const edges = buildSimilarityEdges(skills, { threshold: 0.6, degreeCap: 3 });
    const degree = new Map<string, number>();
    for (const e of edges) {
      degree.set(e.skillA, (degree.get(e.skillA) ?? 0) + 1);
      degree.set(e.skillB, (degree.get(e.skillB) ?? 0) + 1);
    }
    for (const [, d] of degree) expect(d).toBeLessThanOrEqual(3);
  });

  it("keeps the STRONGEST edges when capping", () => {
    const skills = [
      s("centre", 1, 0, 0),
      s("near", 1, 0.05, 0),
      s("mid", 1, 0.3, 0),
      s("far", 1, 0.6, 0),
    ];
    const edges = buildSimilarityEdges(skills, { threshold: 0.6, degreeCap: 1 });

    // The cap is per node, not global, so other disjoint pairs may still survive.
    // What must hold is that `centre` spent its single slot on its closest
    // neighbour rather than on whichever pair happened to be visited first.
    const centreEdge = edges.find(
      (e) => e.skillA === "centre" || e.skillB === "centre"
    )!;
    expect(centreEdge).toBeDefined();
    expect(new Set([centreEdge.skillA, centreEdge.skillB])).toEqual(
      new Set(["centre", "near"])
    );

    for (const id of ["centre", "near", "mid", "far"]) {
      const degree = edges.filter((e) => e.skillA === id || e.skillB === id).length;
      expect(degree).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic across input orderings", () => {
    // A rebuild on unchanged data must produce an identical edge set, or the
    // scheduler drifts for reasons invisible in the log.
    const skills = [s("a", 1, 0, 0), s("b", 1, 0.1, 0), s("c", 1, 0.2, 0)];
    const forward = buildSimilarityEdges(skills, { threshold: 0.6, degreeCap: 1 });
    const reversed = buildSimilarityEdges([...skills].reverse(), {
      threshold: 0.6,
      degreeCap: 1,
    });
    expect(forward).toEqual(reversed);
  });

  it("handles empty and single-skill graphs", () => {
    expect(buildSimilarityEdges([])).toEqual([]);
    expect(buildSimilarityEdges([s("only", 1, 0, 0)])).toEqual([]);
  });
});

describe("interference — §7", () => {
  const graph = buildSimilarityGraph([
    { skillA: "passe_compose", skillB: "imparfait", sim: 0.85 },
    { skillA: "imparfait", skillB: "subjonctif", sim: 0.72 },
    { skillA: "blues_scale", skillB: "pentatonic", sim: 0.78 },
  ]);

  const justPractised = (id: string): RecentPractice[] => [
    { skillId: id, blocksAgo: 1 },
  ];

  it("penalises a skill adjacent to what was just practised", () => {
    expect(interference("imparfait", graph, justPractised("passe_compose"))).toBeCloseTo(
      0.85,
      10
    );
  });

  it("does not penalise a skill in an unrelated domain", () => {
    // The cross-domain case: nothing semantically adjacent was just practised.
    expect(interference("blues_scale", graph, justPractised("passe_compose"))).toBe(0);
  });

  it("takes the max, not the sum, over recent neighbours", () => {
    // A sum would conflate "how close is the nearest recent skill" with "how many
    // recent skills were there", and would scale with graph density.
    const recent: RecentPractice[] = [
      { skillId: "passe_compose", blocksAgo: 1 },
      { skillId: "subjonctif", blocksAgo: 1 },
    ];
    const intf = interference("imparfait", graph, recent);
    expect(intf).toBeCloseTo(0.85, 10);
    expect(intf).toBeLessThanOrEqual(1);
  });

  it("respects the window", () => {
    const stale: RecentPractice[] = [{ skillId: "passe_compose", blocksAgo: 2 }];
    expect(interference("imparfait", graph, stale, 1)).toBe(0);
    expect(interference("imparfait", graph, stale, 2)).toBeCloseTo(0.85, 10);
  });

  it("does not treat a skill as its own interferer", () => {
    // Repeating the same skill is a block-length question, which §7 leaves to
    // fatigue and the hysteresis margin.
    expect(interference("imparfait", graph, justPractised("imparfait"))).toBe(0);
  });

  it("is 0 for a skill with no similar neighbours", () => {
    expect(interference("isolated", graph, justPractised("passe_compose"))).toBe(0);
  });

  it("stays within [0,1]", () => {
    for (const id of ["imparfait", "blues_scale", "isolated"]) {
      const v = interference(id, graph, justPractised("passe_compose"));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("names the responsible skill for the explanation surface", () => {
    const source = interferenceSource("imparfait", graph, [
      { skillId: "passe_compose", blocksAgo: 1 },
      { skillId: "subjonctif", blocksAgo: 1 },
    ]);
    expect(source).toEqual({ skillId: "passe_compose", sim: 0.85 });
  });

  it("names nothing when there is no interference", () => {
    expect(interferenceSource("blues_scale", graph, justPractised("passe_compose"))).toBeNull();
  });
});

describe("similarityTo — sim_context for the event log", () => {
  const graph = buildSimilarityGraph([
    { skillA: "a", skillB: "b", sim: 0.81 },
  ]);

  it("reports the measured similarity to the previous block", () => {
    expect(similarityTo(graph, "a", "b")).toBeCloseTo(0.81, 10);
    expect(similarityTo(graph, "b", "a")).toBeCloseTo(0.81, 10);
  });

  it("is 0 with no previous block, or against itself", () => {
    expect(similarityTo(graph, "a", null)).toBe(0);
    expect(similarityTo(graph, "a", "a")).toBe(0);
  });

  it("is 0 for an unconnected pair — the low-similarity regime", () => {
    // This is what distinguishes 'the interference penalty did nothing' from
    // 'there was nothing for it to do'.
    expect(similarityTo(graph, "a", "unrelated")).toBe(0);
  });
});

describe("skillEmbeddingText", () => {
  it("includes name, description, and the retrieval-cue pool", () => {
    const text = skillEmbeddingText({
      name: "Passé composé",
      description: "French past tense",
      promptTexts: ["Conjugate avoir in the past tense"],
    });
    expect(text).toContain("Passé composé");
    expect(text).toContain("French past tense");
    expect(text).toContain("Conjugate avoir");
  });

  it("distinguishes skills whose names alone are uninformative", () => {
    // "Chapter 3" vs "Chapter 4" are indistinguishable by title and obviously
    // distinguishable by what they ask you to retrieve.
    const a = skillEmbeddingText({ name: "Chapter 3", promptTexts: ["Derive the chain rule"] });
    const b = skillEmbeddingText({ name: "Chapter 4", promptTexts: ["Conjugate être"] });
    expect(a).not.toBe(b);
    expect(a).toContain("chain rule");
    expect(b).toContain("être");
  });

  it("caps the cue pool so it cannot swamp the name", () => {
    const many = Array.from({ length: 40 }, (_, i) => `cue number ${i}`);
    const text = skillEmbeddingText({ name: "Skill", promptTexts: many });
    expect(text).not.toContain("cue number 20");
  });

  it("tolerates a missing description and empty pool", () => {
    expect(skillEmbeddingText({ name: "Solo" })).toBe("Solo");
    expect(skillEmbeddingText({ name: "Solo", description: null, promptTexts: [] })).toBe(
      "Solo"
    );
  });
});

describe("LexicalEmbeddingProvider", () => {
  const provider = new LexicalEmbeddingProvider();

  it("is deterministic", async () => {
    const [a] = await provider.embed(["Passé composé conjugation"]);
    const [b] = await provider.embed(["Passé composé conjugation"]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 10);
  });

  it("produces unit vectors", async () => {
    const [v] = await provider.embed(["Blues scale in A"]);
    let norm = 0;
    for (const x of v) norm += x * x;
    expect(Math.sqrt(norm)).toBeCloseTo(1, 5);
  });

  it("scores shared vocabulary as similar", async () => {
    const [a, b] = await provider.embed([
      "Passé composé conjugation",
      "Present perfect conjugation",
    ]);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.2);
  });

  it("demonstrates its own documented blind spot", async () => {
    // Kept as a test rather than only a comment: lexical similarity cannot see
    // synonymy, and anyone tempted to ship this as the default should have to
    // delete an assertion that says so.
    const [blues, pentatonic] = await provider.embed([
      "Blues scale in A",
      "Pentatonic improvisation",
    ]);
    expect(cosineSimilarity(blues, pentatonic)).toBeLessThan(0.2);
  });

  it("handles empty input", async () => {
    expect(await provider.embed([])).toEqual([]);
    const [v] = await provider.embed([""]);
    expect(v.length).toBe(provider.dimensions);
  });
});
