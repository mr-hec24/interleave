import { describe, it, expect } from "vitest";
import { normaliseExtraction } from "../import/extract";
import { CHANNELS, UNIFORM_LOADING } from "../fatigue";

function raw(over: Partial<Parameters<typeof normaliseExtraction>[0]> = {}) {
  return {
    skills: [],
    prerequisites: [],
    ...over,
  } as Parameters<typeof normaliseExtraction>[0];
}

function skill(over: Record<string, unknown> = {}) {
  return {
    key: "s1",
    name: "Passé composé",
    description: "French past tense",
    channel_loadings: { logical: 1, verbal: 3, visual: 0, motor: 0 },
    retrieval_cues: ["Conjugate venir in the passé composé"],
    ...over,
  } as never;
}

describe("normaliseExtraction — skills", () => {
  it("normalises channel loadings onto the simplex", () => {
    const { skills } = normaliseExtraction(raw({ skills: [skill()] }));
    const sum = skills[0].channelLoadings.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 12);
    // verbal is index 1 in CHANNELS order
    expect(CHANNELS[1]).toBe("verbal");
    expect(skills[0].channelLoadings[1]).toBeCloseTo(0.75, 12);
  });

  it("falls back to uniform loading when the model emits nothing usable", () => {
    const { skills } = normaliseExtraction(
      raw({
        skills: [skill({ channel_loadings: { logical: 0, verbal: 0, visual: 0, motor: 0 } })],
      })
    );
    expect(skills[0].channelLoadings).toEqual([...UNIFORM_LOADING]);
  });

  it("tolerates a missing channel_loadings object entirely", () => {
    const { skills } = normaliseExtraction(
      raw({ skills: [skill({ channel_loadings: undefined })] })
    );
    expect(skills[0].channelLoadings).toEqual([...UNIFORM_LOADING]);
  });

  it("caps cues at five but leaves under-delivery alone", () => {
    // Fewer cues drawn from thin material is the honest outcome — padding it would
    // manufacture exactly the vague cue the measurement layer exists to prevent.
    const many = normaliseExtraction(
      raw({ skills: [skill({ retrieval_cues: Array.from({ length: 9 }, (_, i) => `cue ${i}`) })] })
    );
    expect(many.skills[0].retrievalCues).toHaveLength(5);

    const few = normaliseExtraction(
      raw({ skills: [skill({ retrieval_cues: ["only one"] })] })
    );
    expect(few.skills[0].retrievalCues).toHaveLength(1);
  });

  it("drops blank cues", () => {
    const { skills } = normaliseExtraction(
      raw({ skills: [skill({ retrieval_cues: ["real cue", "   ", ""] })] })
    );
    expect(skills[0].retrievalCues).toEqual(["real cue"]);
  });

  it("drops skills with no key or no name, and de-duplicates keys", () => {
    const { skills } = normaliseExtraction(
      raw({
        skills: [
          skill({ key: "a" }),
          skill({ key: "", name: "Unreferenceable" }),
          skill({ key: "b", name: "  " }),
          skill({ key: "a", name: "Duplicate key" }),
        ],
      })
    );
    expect(skills.map((s) => s.key)).toEqual(["a"]);
  });
});

describe("normaliseExtraction — edges", () => {
  const two = [skill({ key: "basics" }), skill({ key: "advanced" })];

  it("keeps a well-formed edge", () => {
    const { edges, rejectedEdges } = normaliseExtraction(
      raw({
        skills: two,
        prerequisites: [
          { skill_key: "advanced", prereq_key: "basics", rationale: "needs the basics" },
        ],
      })
    );
    expect(edges).toHaveLength(1);
    expect(rejectedEdges).toHaveLength(0);
  });

  it("rejects an edge referencing a skill that was not extracted", () => {
    const { edges, rejectedEdges } = normaliseExtraction(
      raw({
        skills: two,
        prerequisites: [
          { skill_key: "advanced", prereq_key: "ghost", rationale: "" },
        ],
      })
    );
    expect(edges).toHaveLength(0);
    expect(rejectedEdges[0].reason).toMatch(/not extracted/);
  });

  it("rejects a self-edge", () => {
    const { edges, rejectedEdges } = normaliseExtraction(
      raw({
        skills: two,
        prerequisites: [{ skill_key: "basics", prereq_key: "basics", rationale: "" }],
      })
    );
    expect(edges).toHaveLength(0);
    expect(rejectedEdges[0].reason).toMatch(/itself/);
  });

  it("drops only the edge that closes a cycle, keeping the rest", () => {
    // Validating incrementally matters: the database trigger rejects one insert at
    // a time, which would abort the import mid-write and leave a partial graph.
    const { edges, rejectedEdges } = normaliseExtraction(
      raw({
        skills: [skill({ key: "a" }), skill({ key: "b" }), skill({ key: "c" })],
        prerequisites: [
          { skill_key: "b", prereq_key: "a", rationale: "" },
          { skill_key: "c", prereq_key: "b", rationale: "" },
          { skill_key: "a", prereq_key: "c", rationale: "" }, // closes the cycle
        ],
      })
    );
    expect(edges).toHaveLength(2);
    expect(rejectedEdges).toHaveLength(1);
    expect(rejectedEdges[0].edge.skillKey).toBe("a");
    expect(rejectedEdges[0].reason).toMatch(/circular/);
  });

  it("preserves the rationale for the confirmation UI", () => {
    const { edges } = normaliseExtraction(
      raw({
        skills: two,
        prerequisites: [
          {
            skill_key: "advanced",
            prereq_key: "basics",
            rationale: "You cannot conjugate before you know the auxiliaries.",
          },
        ],
      })
    );
    expect(edges[0].rationale).toContain("auxiliaries");
  });
});

describe("normaliseExtraction — malformed input", () => {
  it("tolerates missing top-level arrays", () => {
    const result = normaliseExtraction({} as never);
    expect(result.skills).toEqual([]);
    expect(result.edges).toEqual([]);
    expect(result.rejectedEdges).toEqual([]);
  });
});
