"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ScopeGuidance from "./ScopeGuidance";

interface ExistingSkill {
  id: string;
  name: string;
  description: string | null;
  topic_id?: string | null;
}

interface TopicOption {
  id: string;
  name: string;
}

interface Props {
  onCreated: () => void;
  onCancel: () => void;
  /** When provided, the form edits this skill instead of creating a new one. */
  skill?: ExistingSkill;
  /** Topics the skill can be assigned to. */
  topics?: TopicOption[];
  /** Pre-select this topic when creating a new skill. */
  defaultTopicId?: string | null;
}

export default function SkillForm({
  onCreated,
  onCancel,
  skill,
  topics = [],
  defaultTopicId = null,
}: Props) {
  const isEditing = !!skill;
  const [name, setName] = useState(skill?.name ?? "");
  const [description, setDescription] = useState(skill?.description ?? "");
  const [topicId, setTopicId] = useState<string | null>(
    skill?.topic_id ?? defaultTopicId
  );
  const [stage, setStage] = useState<"details" | "cues">("details");
  const [cues, setCues] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  /**
   * Creating a skill goes through a cue step; editing one does not.
   *
   * The measurement invariant has to hold for typed-in skills exactly as it does
   * for imported ones (see lib/v1/prompts.ts) — otherwise the event log carries two
   * populations that look identical but weren't measured the same way. Editing an
   * existing skill is exempt because its cues already exist and are managed
   * separately.
   */
  async function handleContinue(e: React.FormEvent) {
    e.preventDefault();
    if (isEditing) return handleSubmit();

    setLoading(true);
    setError(null);
    setStage("cues");

    // Suggestions are a convenience, not a gate: if the endpoint is unavailable or
    // the key is unset, the learner writes their own and creation still works.
    try {
      const res = await fetch("/api/import/cues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() }),
      });
      const data = await res.json();
      setCues(data.cues?.length ? data.cues : [""]);
    } catch {
      setCues([""]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit() {
    setLoading(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Not authenticated");
      setLoading(false);
      return;
    }

    const fields = {
      name: name.trim(),
      description: description.trim() || null,
      topic_id: topicId,
    };

    if (isEditing) {
      const { error: writeError } = await supabase
        .from("skills")
        .update(fields)
        .eq("id", skill!.id);
      if (writeError) {
        setError(writeError.message);
        setLoading(false);
        return;
      }
      onCreated();
      return;
    }

    const liveCues = cues.map((c) => c.trim()).filter(Boolean);
    if (liveCues.length === 0) {
      setError("Add at least one cue — a skill with no cue can't be practised.");
      setLoading(false);
      return;
    }

    const { data: created, error: writeError } = await supabase
      .from("skills")
      .insert({ user_id: user.id, ...fields })
      .select("id")
      .single();

    if (writeError || !created) {
      setError(writeError?.message ?? "Could not create the skill.");
      setLoading(false);
      return;
    }

    const { error: cueError } = await supabase.from("retrieval_prompts").insert(
      liveCues.map((text) => ({
        user_id: user.id,
        skill_id: created.id,
        text,
        source: "user" as const,
      }))
    );
    if (cueError) {
      setError(`Skill created, but its cues failed to save: ${cueError.message}`);
      setLoading(false);
      return;
    }

    onCreated();
  }

  const labelCls =
    "block text-[10px] font-bold tracking-[0.08em] uppercase text-ink-mute mb-1.5";
  const inputCls =
    "w-full box-border text-[15px] font-medium text-ink bg-surface border border-edge rounded-xl px-3.5 py-3 placeholder-ink-mute";

  if (stage === "cues") {
    return (
      <div className="bg-surface-2 rounded-2xl border border-edge shadow-[var(--shadow)] overflow-hidden mb-4">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-edge">
          <button
            type="button"
            onClick={() => setStage("details")}
            className="text-sm font-medium text-ink-soft hover:text-ink"
          >
            Back
          </button>
          <span className="font-display font-semibold text-lg text-ink">
            How will you practise it?
          </span>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || cues.every((c) => !c.trim())}
            className="text-sm font-semibold text-green-deep disabled:opacity-50"
          >
            {loading ? "Saving…" : "Save"}
          </button>
        </div>

        <div className="p-5 flex flex-col gap-3">
          <div className="bg-tint border border-tint-border rounded-xl px-4 py-3">
            <p className="text-xs leading-relaxed text-ink-soft">
              A cue is a <b className="text-tint-ink">prompt to retrieve from
              memory</b> — you do it on your instrument, in your editor, on paper,
              then come back and rate how it went. Interleaf never grades the
              attempt; it records that you made one against this specific cue.
            </p>
            <p className="text-xs leading-relaxed text-ink-mute mt-2">
              The test of a good cue: afterwards, can you answer yes or no to
              &ldquo;did I recall that?&rdquo;
            </p>
          </div>

          {loading && cues.length === 0 ? (
            <p className="text-sm text-ink-mute">Drafting some cues…</p>
          ) : (
            <>
              {cues.map((cue, i) => (
                <textarea
                  key={i}
                  value={cue}
                  rows={2}
                  placeholder="e.g. Play the F major scale from memory, both hands."
                  onChange={(e) => {
                    const next = [...cues];
                    next[i] = e.target.value;
                    setCues(next);
                  }}
                  className={`${inputCls} resize-none text-[14px]`}
                />
              ))}
              <button
                type="button"
                onClick={() => setCues([...cues, ""])}
                className="self-start text-xs text-ink-mute hover:text-ink"
              >
                + Add another cue
              </button>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleContinue}
      className="bg-surface-2 rounded-2xl border border-edge shadow-[var(--shadow)] overflow-hidden mb-4"
    >
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-edge">
        <button
          type="button"
          onClick={onCancel}
          className="text-sm font-medium text-ink-soft hover:text-ink"
        >
          Cancel
        </button>
        <span className="font-display font-semibold text-lg text-ink">
          {isEditing ? "Edit skill" : "New skill"}
        </span>
        <button
          type="submit"
          disabled={loading}
          className="text-sm font-semibold text-green-deep disabled:opacity-50"
        >
          {loading ? "Saving…" : isEditing ? "Save" : "Next"}
        </button>
      </div>

      <div className="p-5 flex flex-col gap-4">
        <ScopeGuidance variant="skill" />

        <div>
          <label className={labelCls} htmlFor="sk-name">
            Skill name
          </label>
          <input
            id="sk-name"
            type="text"
            placeholder="e.g. Blues scale in A"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={inputCls}
          />
        </div>

        {topics.length > 0 && (
          <div>
            <label className={labelCls} htmlFor="sk-topic">
              Topic (planter)
            </label>
            <select
              id="sk-topic"
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
          <label className={labelCls} htmlFor="sk-notes">
            Notes{" "}
            <span className="normal-case tracking-normal font-normal text-ink-mute">
              (optional)
            </span>
          </label>
          <textarea
            id="sk-notes"
            rows={2}
            placeholder="What to focus on; what trips you up."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${inputCls} resize-none`}
          />
        </div>

        <div className="flex items-start gap-2.5 bg-tint border border-tint-border rounded-xl px-3.5 py-3">
          <svg width="16" height="16" viewBox="0 0 100 100" aria-hidden="true" className="flex-shrink-0 mt-0.5">
            <path d="M50,92 L50,52" stroke="var(--green)" strokeWidth="8" strokeLinecap="round" />
            <ellipse cx="50" cy="40" rx="11" ry="18" fill="var(--green)" />
          </svg>
          <span className="text-xs leading-relaxed text-ink-soft">
            Interleaf chooses when you&apos;ll practise this — no reminders to set.
            You just tend the garden when it asks.
          </span>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </form>
  );
}
