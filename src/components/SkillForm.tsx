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

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-lg border border-gray-200 p-4 mb-4 space-y-3"
    >
      <ScopeGuidance variant="skill" />
      <input
        type="text"
        placeholder="Skill name (e.g. Guitar fingerpicking)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 placeholder-gray-400"
      />
      <input
        type="text"
        placeholder="Description (optional)"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 placeholder-gray-400"
      />
      {topics.length > 0 && (
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600">Topic:</label>
          <select
            value={topicId ?? ""}
            onChange={(e) => setTopicId(e.target.value || null)}
            className="px-2 py-1 border border-gray-300 rounded-md text-sm text-gray-900"
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
      <div className="flex items-center gap-2">
        <label className="text-sm text-gray-600">Default session:</label>
        <input
          type="number"
          min={5}
          max={120}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          className="w-20 px-2 py-1 border border-gray-300 rounded-md text-sm text-gray-900"
        />
        <span className="text-sm text-gray-500">min</span>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-800 disabled:opacity-50"
        >
          {loading
            ? "Saving…"
            : isEditing
              ? "Save changes"
              : "Add skill"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
