"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface ExistingTopic {
  id: string;
  name: string;
  description: string | null;
  notes: string | null;
}

interface Props {
  onSaved: () => void;
  onCancel: () => void;
  /** When provided, the form edits this topic instead of creating a new one. */
  topic?: ExistingTopic;
}

export default function TopicForm({ onSaved, onCancel, topic }: Props) {
  const isEditing = !!topic;
  const [name, setName] = useState(topic?.name ?? "");
  const [description, setDescription] = useState(topic?.description ?? "");
  const [notes, setNotes] = useState(topic?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      notes: notes.trim() || null,
    };

    const { error: writeError } = isEditing
      ? await supabase.from("topics").update(fields).eq("id", topic!.id)
      : await supabase.from("topics").insert({ user_id: user.id, ...fields });

    if (writeError) {
      setError(writeError.message);
      setLoading(false);
    } else {
      onSaved();
    }
  }

  const labelCls =
    "block text-[10px] font-bold tracking-[0.08em] uppercase text-ink-mute mb-1.5";
  const inputCls =
    "w-full box-border text-[15px] font-medium text-ink bg-surface border border-edge rounded-xl px-3.5 py-3 placeholder-ink-mute";

  return (
    <form
      onSubmit={handleSubmit}
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
          {isEditing ? "Edit topic" : "New topic"}
        </span>
        <button
          type="submit"
          disabled={loading}
          className="text-sm font-semibold text-green-deep disabled:opacity-50"
        >
          {loading ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="p-5 flex flex-col gap-4">
        <div>
          <label className={labelCls} htmlFor="tp-name">
            Topic name
          </label>
          <input
            id="tp-name"
            type="text"
            placeholder="e.g. French"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls} htmlFor="tp-desc">
            Description{" "}
            <span className="normal-case tracking-normal font-normal text-ink-mute">
              (optional)
            </span>
          </label>
          <input
            id="tp-desc"
            type="text"
            placeholder="A short note about this planter."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
          />
        </div>

        <div>
          <label className={labelCls} htmlFor="tp-syl">
            Syllabus &amp; notes
          </label>
          <textarea
            id="tp-syl"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            placeholder="Paste a syllabus, rubric, or your own plan for this topic — Interleaf keeps it with the planter."
            className={`${inputCls} resize-none`}
          />
          <p className="text-xs text-ink-mute mt-1.5 px-0.5">
            A free space for your plan — Interleaf keeps it with the planter.
          </p>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </form>
  );
}
