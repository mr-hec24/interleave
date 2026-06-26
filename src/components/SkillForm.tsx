"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import ScopeGuidance from "./ScopeGuidance";

interface ExistingSkill {
  id: string;
  name: string;
  description: string | null;
  default_session_minutes: number;
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
  const [minutes, setMinutes] = useState(skill?.default_session_minutes ?? 25);
  const [topicId, setTopicId] = useState<string | null>(
    skill?.topic_id ?? defaultTopicId
  );
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
      default_session_minutes: minutes,
      topic_id: topicId,
    };

    const { error: writeError } = isEditing
      ? await supabase.from("skills").update(fields).eq("id", skill!.id)
      : await supabase.from("skills").insert({ user_id: user.id, ...fields });

    if (writeError) {
      setError(writeError.message);
      setLoading(false);
    } else {
      onCreated();
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
          {isEditing ? "Edit skill" : "New skill"}
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

        <div>
          <label className={labelCls} htmlFor="sk-minutes">
            Default session length
          </label>
          <div className="flex items-center gap-2">
            <input
              id="sk-minutes"
              type="number"
              min={5}
              max={120}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              className="w-24 box-border text-[15px] font-medium text-ink bg-surface border border-edge rounded-xl px-3.5 py-2.5"
            />
            <span className="text-sm text-ink-mute">min</span>
          </div>
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
