"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

interface Prompt {
  id: string;
  text: string;
  source: "llm" | "user" | "migrated";
  last_served_at: string | null;
  times_served: number;
}

interface Props {
  skillId: string;
  skillName: string;
  onClose: () => void;
  /** Fired after any change, so the parent can refresh schedulability. */
  onChanged?: () => void;
}

const SOURCE_LABEL: Record<Prompt["source"], string> = {
  llm: "suggested",
  user: "yours",
  migrated: "placeholder",
};

/**
 * Editor for a skill's retrieval-prompt pool.
 *
 * A prompt is a *cue*, not an exercise: the learner performs the retrieval away
 * from the screen and grades it afterwards. The UI's job is to make that
 * distinction obvious, because a pool full of vague cues quietly destroys the
 * grade semantics the whole scheduler depends on.
 *
 * Suggested cues are never authoritative — they are seeded from the learner's own
 * material and are fully editable, which is the same rule §9.3 sets for
 * LLM-extracted prerequisite edges.
 */
export default function PromptEditor({ skillId, skillName, onClose, onChanged }: Props) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const load = useCallback(async () => {
    const { data, error: loadError } = await supabase
      .from("retrieval_prompts")
      .select("id, text, source, last_served_at, times_served")
      .eq("skill_id", skillId)
      .is("archived_at", null)
      .order("created_at", { ascending: true });
    if (loadError) setError(loadError.message);
    setPrompts(data ?? []);
    setLoading(false);
  }, [supabase, skillId]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const text = draft.trim();
    if (!text) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return setError("Not authenticated");

    const { error: writeError } = await supabase.from("retrieval_prompts").insert({
      user_id: user.id,
      skill_id: skillId,
      text,
      source: "user",
    });
    if (writeError) return setError(writeError.message);
    setDraft("");
    await load();
    onChanged?.();
  }

  async function saveEdit(id: string) {
    const text = editText.trim();
    if (!text) return;
    // An edited cue is the learner's, whatever it started as — and the change of
    // source is itself the signal that a suggestion missed.
    const { error: writeError } = await supabase
      .from("retrieval_prompts")
      .update({ text, source: "user" })
      .eq("id", id);
    if (writeError) return setError(writeError.message);
    setEditingId(null);
    await load();
    onChanged?.();
  }

  async function archive(p: Prompt) {
    if (prompts.length === 1) {
      setError(
        "This is the only cue for this skill. A skill with no cue can't be practised, " +
          "so add a replacement before removing this one."
      );
      return;
    }
    // Soft archive: logged events point at this row and must keep resolving.
    const { error: writeError } = await supabase
      .from("retrieval_prompts")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", p.id);
    if (writeError) return setError(writeError.message);
    await load();
    onChanged?.();
  }

  const placeholderCount = prompts.filter((p) => p.source === "migrated").length;

  const inputCls =
    "w-full box-border text-[15px] font-medium text-ink bg-surface border border-edge rounded-xl px-3.5 py-3 placeholder-ink-mute";

  return (
    <div className="fixed inset-0 bg-black/50 overflow-y-auto z-50">
      <div className="min-h-full flex items-start justify-center p-4 py-10">
        <div className="w-full max-w-2xl bg-surface-2 rounded-2xl border border-edge shadow-[var(--shadow)] overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-edge">
            <button
              type="button"
              onClick={onClose}
              className="text-sm font-medium text-ink-soft hover:text-ink"
            >
              Close
            </button>
            <span className="font-display font-semibold text-lg text-ink truncate px-3">
              Cues for {skillName}
            </span>
            <span className="text-sm text-ink-mute tabular-nums">{prompts.length}</span>
          </div>

          <div className="p-5 flex flex-col gap-4">
            <div className="bg-tint border border-tint-border rounded-xl px-4 py-3">
              <p className="text-xs leading-relaxed text-ink-soft">
                A cue is a <b className="text-tint-ink">prompt to retrieve from memory</b>,
                not an exercise to complete here. You do it on your instrument, in your
                editor, on paper — then come back and rate how it went.
              </p>
              <p className="text-xs leading-relaxed text-ink-mute mt-2">
                Good: <i>&ldquo;Play the F major scale from memory, both hands.&rdquo;</i>{" "}
                Weak: <i>&ldquo;Practise scales.&rdquo;</i> The difference is whether you
                can answer yes or no to having recalled it.
              </p>
            </div>

            {placeholderCount > 0 && (
              <div className="border border-edge rounded-xl px-4 py-3 bg-surface">
                <p className="text-xs leading-relaxed text-ink-soft">
                  <b className="text-ink">
                    {placeholderCount} placeholder{placeholderCount === 1 ? "" : "s"}
                  </b>{" "}
                  carried over from before Interleaf recorded what you were actually
                  retrieving. Replacing them with specific cues is what makes this
                  skill&apos;s numbers mean something.
                </p>
              </div>
            )}

            {loading ? (
              <p className="text-sm text-ink-mute">Loading…</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {prompts.map((p) =>
                  editingId === p.id ? (
                    <div key={p.id} className="flex flex-col gap-2">
                      <textarea
                        value={editText}
                        onChange={(e) => setEditText(e.target.value)}
                        rows={3}
                        className={`${inputCls} resize-none`}
                        autoFocus
                      />
                      <div className="flex gap-3 justify-end text-sm">
                        <button
                          onClick={() => setEditingId(null)}
                          className="text-ink-mute hover:text-ink font-medium"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveEdit(p.id)}
                          className="text-green-deep font-semibold"
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={p.id}
                      className="group bg-surface border border-edge rounded-xl px-4 py-3"
                    >
                      <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">
                        {p.text}
                      </p>
                      <div className="flex items-center gap-3 mt-2 text-[11px] text-ink-mute">
                        <span
                          className={
                            p.source === "migrated" ? "text-clay font-semibold" : ""
                          }
                        >
                          {SOURCE_LABEL[p.source]}
                        </span>
                        <span>
                          served {p.times_served}
                          {p.times_served === 1 ? " time" : " times"}
                        </span>
                        <div className="ml-auto flex gap-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                          <button
                            onClick={() => {
                              setEditingId(p.id);
                              setEditText(p.text);
                            }}
                            className="hover:text-ink"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => archive(p)}
                            className="hover:text-red-600"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                )}
              </div>
            )}

            <div className="flex flex-col gap-2 border-t border-edge pt-4">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                placeholder="Add a cue — something specific you can attempt from memory."
                className={`${inputCls} resize-none`}
              />
              <button
                onClick={add}
                disabled={!draft.trim()}
                className="self-end font-semibold text-on-green bg-green-btn rounded-xl px-5 py-2.5 text-sm disabled:opacity-50"
              >
                Add cue
              </button>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
