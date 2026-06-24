"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface Props {
  onCreated: () => void;
  onCancel: () => void;
}

export default function SkillForm({ onCreated, onCancel }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [minutes, setMinutes] = useState(25);
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

    const { error: insertError } = await supabase.from("skills").insert({
      user_id: user.id,
      name: name.trim(),
      description: description.trim() || null,
      default_session_minutes: minutes,
    });

    if (insertError) {
      setError(insertError.message);
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
          {loading ? "Adding…" : "Add skill"}
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
