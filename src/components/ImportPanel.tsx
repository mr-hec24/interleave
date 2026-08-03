"use client";

import { useState } from "react";

interface ExtractedSkill {
  key: string;
  name: string;
  description: string;
  channelLoadings: number[];
  retrievalCues: string[];
}

interface ExtractedEdge {
  skillKey: string;
  prereqKey: string;
  rationale: string;
}

interface Proposal {
  skills: ExtractedSkill[];
  edges: ExtractedEdge[];
  rejectedEdges: Array<{ edge: ExtractedEdge; reason: string }>;
}

interface Props {
  topics: Array<{ id: string; name: string }>;
  onImported: () => void;
  onCancel: () => void;
}

const CHANNEL_LABEL = ["logical", "verbal", "visual", "motor"] as const;

/**
 * The §8 import flow, in two explicit steps: propose, then commit what was accepted.
 *
 * The review step is not a formality. §2 calls LLM-extracted prerequisite edges
 * noisy by construction, and a wrong edge locks a skill the learner could have
 * practised — so edges arrive as decisions to make, not a result to accept. Cues are
 * editable for the same reason one level down: their quality is bounded by the
 * material fed in, and a vague cue produces an ungradeable retrieval.
 */
export default function ImportPanel({ topics, onImported, onCancel }: Props) {
  const [material, setMaterial] = useState("");
  const [topicId, setTopicId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [skillsKept, setSkillsKept] = useState<Set<string>>(new Set());
  const [edgesKept, setEdgesKept] = useState<Set<string>>(new Set());
  const [cueEdits, setCueEdits] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edgeId = (e: ExtractedEdge) => `${e.prereqKey}→${e.skillKey}`;
  const nameFor = (key: string) =>
    proposal?.skills.find((s) => s.key === key)?.name ?? key;

  async function runExtraction() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          material,
          topicName: topics.find((t) => t.id === topicId)?.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed.");

      setProposal(data);
      setSkillsKept(new Set(data.skills.map((s: ExtractedSkill) => s.key)));
      // Edges start UNCHECKED. Accepting a prerequisite gates a skill out of the
      // rotation, so it should be a deliberate act rather than the default.
      setEdgesKept(new Set());
      setCueEdits(
        Object.fromEntries(
          data.skills.map((s: ExtractedSkill) => [s.key, s.retrievalCues])
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setLoading(false);
    }
  }

  async function commit() {
    if (!proposal) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicId,
          skills: proposal.skills
            .filter((s) => skillsKept.has(s.key))
            .map((s) => ({
              key: s.key,
              name: s.name,
              description: s.description,
              channelLoadings: s.channelLoadings,
              retrievalCues: (cueEdits[s.key] ?? []).filter((c) => c.trim()),
            })),
          // Both decisions are sent: a rejected edge is as useful a label as an
          // accepted one for judging extraction quality later.
          edges: proposal.edges
            .filter((e) => skillsKept.has(e.skillKey) && skillsKept.has(e.prereqKey))
            .map((e) => ({
              skillKey: e.skillKey,
              prereqKey: e.prereqKey,
              accepted: edgesKept.has(edgeId(e)),
            })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Import failed.");
      onImported();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setLoading(false);
    }
  }

  const inputCls =
    "w-full box-border text-[15px] font-medium text-ink bg-surface border border-edge rounded-xl px-3.5 py-3 placeholder-ink-mute";
  const labelCls =
    "block text-[10px] font-bold tracking-[0.08em] uppercase text-ink-mute mb-1.5";

  return (
    <div className="fixed inset-0 bg-black/50 overflow-y-auto z-50">
      <div className="min-h-full flex items-start justify-center p-4 py-10">
        <div className="w-full max-w-3xl bg-surface-2 rounded-2xl border border-edge shadow-[var(--shadow)] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-edge">
            <button
              onClick={onCancel}
              className="text-sm font-medium text-ink-soft hover:text-ink"
            >
              Cancel
            </button>
            <span className="font-display font-semibold text-lg text-ink">
              {proposal ? "Review what was found" : "Import from your material"}
            </span>
            <span className="w-12" />
          </div>

          <div className="p-5 flex flex-col gap-4">
            {!proposal ? (
              <>
                <div className="bg-tint border border-tint-border rounded-xl px-4 py-3">
                  <p className="text-xs leading-relaxed text-ink-soft">
                    Paste a syllabus, lecture outline, chapter list, or your own
                    notes. Interleaf will propose skills, retrieval cues, and any
                    prerequisites it spots — <b className="text-tint-ink">nothing is
                    saved until you review it</b>.
                  </p>
                  <p className="text-xs leading-relaxed text-ink-mute mt-2">
                    Specific material produces specific cues. A list of concrete
                    topics works far better than a course summary.
                  </p>
                </div>

                {topics.length > 0 && (
                  <div>
                    <label className={labelCls} htmlFor="import-topic">
                      Add to topic
                    </label>
                    <select
                      id="import-topic"
                      value={topicId ?? ""}
                      onChange={(e) => setTopicId(e.target.value || null)}
                      className={inputCls}
                    >
                      <option value="">No topic</option>
                      {topics.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className={labelCls} htmlFor="import-material">
                    Your material
                  </label>
                  <textarea
                    id="import-material"
                    value={material}
                    onChange={(e) => setMaterial(e.target.value)}
                    rows={12}
                    placeholder="Paste your syllabus, outline, or notes here…"
                    className={`${inputCls} resize-y font-mono text-[13px]`}
                  />
                </div>

                <button
                  onClick={runExtraction}
                  disabled={loading || !material.trim()}
                  className="self-end font-semibold text-on-green bg-green-btn rounded-xl px-6 py-3 disabled:opacity-50"
                >
                  {loading ? "Reading your material…" : "Find skills"}
                </button>
              </>
            ) : (
              <>
                <div className="flex items-baseline justify-between">
                  <span className="text-sm text-ink-soft">
                    <b className="text-ink">{skillsKept.size}</b> of{" "}
                    {proposal.skills.length} skills selected
                  </span>
                  <button
                    onClick={() => setProposal(null)}
                    className="text-xs text-ink-mute hover:text-ink"
                  >
                    Start over
                  </button>
                </div>

                <div className="flex flex-col gap-3">
                  {proposal.skills.map((s) => {
                    const kept = skillsKept.has(s.key);
                    const cues = cueEdits[s.key] ?? [];
                    const dominant =
                      CHANNEL_LABEL[
                        s.channelLoadings.indexOf(Math.max(...s.channelLoadings))
                      ];
                    return (
                      <div
                        key={s.key}
                        className={`border rounded-xl px-4 py-3 transition-opacity ${
                          kept
                            ? "bg-surface border-edge"
                            : "bg-surface border-edge opacity-45"
                        }`}
                      >
                        <label className="flex items-start gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={kept}
                            onChange={(e) => {
                              const next = new Set(skillsKept);
                              if (e.target.checked) next.add(s.key);
                              else next.delete(s.key);
                              setSkillsKept(next);
                            }}
                            className="mt-1"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm text-ink">
                              {s.name}
                            </div>
                            {s.description && (
                              <div className="text-xs text-ink-soft mt-0.5">
                                {s.description}
                              </div>
                            )}
                            <div className="text-[11px] text-ink-mute mt-1">
                              mostly {dominant}
                            </div>
                          </div>
                        </label>

                        {kept && (
                          <div className="mt-3 pl-7 flex flex-col gap-1.5">
                            <div className="text-[10px] font-bold tracking-[0.08em] uppercase text-ink-mute">
                              Retrieval cues
                            </div>
                            {cues.map((cue, i) => (
                              <textarea
                                key={i}
                                value={cue}
                                rows={2}
                                onChange={(e) => {
                                  const next = [...cues];
                                  next[i] = e.target.value;
                                  setCueEdits({ ...cueEdits, [s.key]: next });
                                }}
                                className="w-full text-[13px] text-ink bg-surface-2 border border-edge rounded-lg px-3 py-2 resize-none"
                              />
                            ))}
                            <button
                              onClick={() =>
                                setCueEdits({ ...cueEdits, [s.key]: [...cues, ""] })
                              }
                              className="self-start text-[11px] text-ink-mute hover:text-ink mt-0.5"
                            >
                              + Add a cue
                            </button>
                            {cues.filter((c) => c.trim()).length === 0 && (
                              <p className="text-[11px] text-red-600">
                                A skill with no cue can&apos;t be practised — add one
                                or uncheck this skill.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {proposal.edges.length > 0 && (
                  <div className="border-t border-edge pt-4">
                    <div className="font-display font-semibold text-[15px] text-ink">
                      Possible prerequisites
                    </div>
                    <p className="text-xs text-ink-soft mt-1 mb-3 leading-relaxed">
                      These are guesses from your material, and they are{" "}
                      <b className="text-ink">off by default</b>. Accepting one stops
                      the dependent skill being scheduled until the prerequisite is
                      established — useful when it&apos;s genuinely true, and a
                      nuisance when it isn&apos;t.
                    </p>
                    <div className="flex flex-col gap-2">
                      {proposal.edges
                        .filter(
                          (e) =>
                            skillsKept.has(e.skillKey) && skillsKept.has(e.prereqKey)
                        )
                        .map((e) => (
                          <label
                            key={edgeId(e)}
                            className="flex items-start gap-3 bg-surface border border-edge rounded-xl px-4 py-3 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={edgesKept.has(edgeId(e))}
                              onChange={(ev) => {
                                const next = new Set(edgesKept);
                                if (ev.target.checked) next.add(edgeId(e));
                                else next.delete(edgeId(e));
                                setEdgesKept(next);
                              }}
                              className="mt-1"
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-ink">
                                <b>{nameFor(e.skillKey)}</b> needs{" "}
                                <b>{nameFor(e.prereqKey)}</b> first
                              </div>
                              {e.rationale && (
                                <div className="text-xs text-ink-soft mt-0.5">
                                  {e.rationale}
                                </div>
                              )}
                            </div>
                          </label>
                        ))}
                    </div>
                  </div>
                )}

                {proposal.rejectedEdges.length > 0 && (
                  <div className="text-[11px] text-ink-mute border-t border-edge pt-3">
                    {proposal.rejectedEdges.length} proposed prerequisite
                    {proposal.rejectedEdges.length === 1 ? " was" : "s were"} dropped
                    automatically (circular or referencing a skill that wasn&apos;t
                    created).
                  </div>
                )}

                <button
                  onClick={commit}
                  disabled={loading || skillsKept.size === 0}
                  className="self-end font-semibold text-on-green bg-green-btn rounded-xl px-6 py-3 disabled:opacity-50"
                >
                  {loading
                    ? "Saving…"
                    : `Add ${skillsKept.size} skill${skillsKept.size === 1 ? "" : "s"}`}
                </button>
              </>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
