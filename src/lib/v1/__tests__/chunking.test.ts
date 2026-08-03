import { describe, it, expect } from "vitest";
import {
  chunkMaterial,
  mergeExtractions,
  CHUNK_CHARS,
  type ExtractionResult,
  type ExtractedSkill,
} from "../import/extract";

const para = (label: string, len: number) =>
  `${label}: ` + "x".repeat(Math.max(0, len - label.length - 2));

function skill(over: Partial<ExtractedSkill> & { key: string; name: string }): ExtractedSkill {
  return {
    description: "",
    channelLoadings: [0.25, 0.25, 0.25, 0.25],
    retrievalCues: ["cue"],
    ...over,
  };
}

function part(over: Partial<ExtractionResult> = {}): ExtractionResult {
  return { skills: [], edges: [], rejectedEdges: [], ...over };
}

describe("chunkMaterial", () => {
  it("keeps short material in one chunk", () => {
    expect(chunkMaterial("Week 1: verbs\n\nWeek 2: nouns")).toHaveLength(1);
  });

  it("splits long material into chunks under the budget", () => {
    const material = Array.from({ length: 20 }, (_, i) => para(`Week ${i}`, 500)).join("\n\n");
    const chunks = chunkMaterial(material);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_CHARS);
  });

  it("never splits mid-paragraph", () => {
    // A week's entry cut in half yields two half-topics, and the model has no way
    // to know it was handed a fragment.
    const paragraphs = Array.from({ length: 12 }, (_, i) => para(`Week ${i}`, 600));
    const chunks = chunkMaterial(paragraphs.join("\n\n"));
    for (const p of paragraphs) {
      expect(chunks.some((c) => c.includes(p))).toBe(true);
    }
  });

  it("loses no content", () => {
    const paragraphs = Array.from({ length: 15 }, (_, i) => para(`Topic ${i}`, 400));
    const chunks = chunkMaterial(paragraphs.join("\n\n"));
    const rejoined = chunks.join("\n\n");
    for (const p of paragraphs) expect(rejoined).toContain(p);
  });

  it("passes an oversized single paragraph through rather than severing it", () => {
    // Better one slow request than two incoherent ones.
    const huge = para("Monolith", CHUNK_CHARS * 2);
    const chunks = chunkMaterial(huge);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(huge);
  });

  it("handles empty and whitespace-only input without producing nothing", () => {
    expect(chunkMaterial("")).toEqual([""]);
    expect(chunkMaterial("   \n\n  ")).toHaveLength(1);
  });
});

describe("mergeExtractions", () => {
  it("namespaces chunk-local keys so two chunks cannot collide", () => {
    const merged = mergeExtractions([
      part({ skills: [skill({ key: "s1", name: "Verbs" })] }),
      part({ skills: [skill({ key: "s1", name: "Nouns" })] }),
    ]);
    expect(merged.skills).toHaveLength(2);
    expect(new Set(merged.skills.map((s) => s.key)).size).toBe(2);
  });

  it("de-duplicates a topic that appears in two chunks", () => {
    // A syllabus revisiting a topic in weeks 3 and 11 should produce one skill,
    // not two competing ones.
    const merged = mergeExtractions([
      part({ skills: [skill({ key: "a", name: "Subjunctive", retrievalCues: ["cue A"] })] }),
      part({ skills: [skill({ key: "z", name: "subjunctive", retrievalCues: ["cue B"] })] }),
    ]);
    expect(merged.skills).toHaveLength(1);
    // A second mention usually phrases the retrieval differently — worth keeping.
    expect(merged.skills[0].retrievalCues).toEqual(["cue A", "cue B"]);
  });

  it("does not duplicate identical cues across chunks", () => {
    const merged = mergeExtractions([
      part({ skills: [skill({ key: "a", name: "Verbs", retrievalCues: ["Conjugate ser"] })] }),
      part({ skills: [skill({ key: "b", name: "Verbs", retrievalCues: ["conjugate ser  "] })] }),
    ]);
    expect(merged.skills[0].retrievalCues).toHaveLength(1);
  });

  it("re-applies the 5-cue cap after merging", () => {
    // A topic mentioned in three chunks could otherwise accumulate a dozen cues,
    // which is a different skill shape than the prompt asks for.
    const merged = mergeExtractions([
      part({ skills: [skill({ key: "a", name: "V", retrievalCues: ["1", "2", "3"] })] }),
      part({ skills: [skill({ key: "b", name: "V", retrievalCues: ["4", "5", "6"] })] }),
    ]);
    expect(merged.skills[0].retrievalCues).toHaveLength(5);
  });

  it("remaps edges onto the merged keys", () => {
    const merged = mergeExtractions([
      part({
        skills: [skill({ key: "a", name: "Basics" }), skill({ key: "b", name: "Advanced" })],
        edges: [{ skillKey: "b", prereqKey: "a", rationale: "needs basics" }],
      }),
    ]);
    const keys = new Set(merged.skills.map((s) => s.key));
    expect(merged.edges).toHaveLength(1);
    expect(keys.has(merged.edges[0].skillKey)).toBe(true);
    expect(keys.has(merged.edges[0].prereqKey)).toBe(true);
  });

  it("drops an edge that collapses onto itself after de-duplication", () => {
    // Two chunk-local skills turning out to be the same topic can leave an edge
    // pointing at itself, which the database would reject.
    const merged = mergeExtractions([
      part({
        skills: [skill({ key: "a", name: "Verbs" }), skill({ key: "b", name: "verbs" })],
        edges: [{ skillKey: "b", prereqKey: "a", rationale: "" }],
      }),
    ]);
    expect(merged.skills).toHaveLength(1);
    expect(merged.edges).toHaveLength(0);
  });

  it("rejects an edge that would close a cycle across chunks", () => {
    const merged = mergeExtractions([
      part({
        skills: [skill({ key: "a", name: "A" }), skill({ key: "b", name: "B" })],
        edges: [{ skillKey: "b", prereqKey: "a", rationale: "" }],
      }),
      part({
        skills: [skill({ key: "x", name: "A" }), skill({ key: "y", name: "B" })],
        edges: [{ skillKey: "x", prereqKey: "y", rationale: "" }],
      }),
    ]);
    expect(merged.edges).toHaveLength(1);
    expect(merged.rejectedEdges.some((r) => /circular/.test(r.reason))).toBe(true);
  });

  it("de-duplicates an identical edge proposed by two chunks", () => {
    const merged = mergeExtractions([
      part({
        skills: [skill({ key: "a", name: "A" }), skill({ key: "b", name: "B" })],
        edges: [{ skillKey: "b", prereqKey: "a", rationale: "" }],
      }),
      part({
        skills: [skill({ key: "p", name: "A" }), skill({ key: "q", name: "B" })],
        edges: [{ skillKey: "q", prereqKey: "p", rationale: "" }],
      }),
    ]);
    expect(merged.edges).toHaveLength(1);
  });

  it("carries per-chunk rejections through", () => {
    const merged = mergeExtractions([
      part({ rejectedEdges: [{ edge: { skillKey: "x", prereqKey: "y", rationale: "" }, reason: "self" }] }),
    ]);
    expect(merged.rejectedEdges).toHaveLength(1);
  });

  it("handles a single part and an empty list", () => {
    expect(mergeExtractions([]).skills).toEqual([]);
    const one = mergeExtractions([part({ skills: [skill({ key: "a", name: "A" })] })]);
    expect(one.skills).toHaveLength(1);
  });
});
