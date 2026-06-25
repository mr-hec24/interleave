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

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-lg border border-gray-200 p-4 mb-4 space-y-3"
    >
      <input
        type="text"
        placeholder="Topic name (e.g. French)"
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
      <div>
        <label className="text-sm text-gray-600 block mb-1">
          Syllabus / notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          placeholder="Paste a syllabus, rubric, or your own notes for this topic. A future feature can use this to suggest skills worth practicing."
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 placeholder-gray-400"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={loading}
          className="px-4 py-2 bg-gray-900 text-white text-sm rounded-md hover:bg-gray-800 disabled:opacity-50"
        >
          {loading ? "Saving…" : isEditing ? "Save changes" : "Add topic"}
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
