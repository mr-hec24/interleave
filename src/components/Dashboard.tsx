"use client";

import { useState, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { rankSkills, formatReasonText } from "@/lib/scheduler";
import type { SchedulerRecommendation } from "@/lib/scheduler";
import SkillForm from "./SkillForm";
import SessionForm from "./SessionForm";
import TopicForm from "./TopicForm";
import RecommendationCard from "./RecommendationCard";

interface Skill {
  id: string;
  name: string;
  description: string | null;
  default_session_minutes: number;
  topic_id: string | null;
  sr_state: {
    repetitions: number;
    ease_factor: number;
    interval_days: number;
    last_reviewed_at: string | null;
    due_at: string | null;
  } | null;
}

interface Topic {
  id: string;
  name: string;
  description: string | null;
  notes: string | null;
}

interface Session {
  id: string;
  skill_id: string;
  duration_minutes: number;
  quality: number;
  created_at: string;
  skills: { name: string } | null;
}

interface DashboardProps {
  user: User;
  skills: Skill[];
  topics: Topic[];
  recentSessions: Session[];
}

export default function Dashboard({
  user,
  skills: initialSkills,
  topics: initialTopics,
  recentSessions: initialSessions,
}: DashboardProps) {
  const [skills, setSkills] = useState(initialSkills);
  const [topics, setTopics] = useState(initialTopics);
  const [sessions, setSessions] = useState(initialSessions);
  const [showSkillForm, setShowSkillForm] = useState(false);
  const [skillFormTopicId, setSkillFormTopicId] = useState<string | null>(null);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [showTopicForm, setShowTopicForm] = useState(false);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [loggingSkillId, setLoggingSkillId] = useState<string | null>(null);
  const supabase = createClient();

  const topicOptions = topics.map((t) => ({ id: t.id, name: t.name }));

  const recommendations: SchedulerRecommendation[] = rankSkills(
    skills.map((s) => ({
      skillId: s.id,
      skillName: s.name,
      intervalDays: s.sr_state?.interval_days ?? 0,
      lastReviewedAt: s.sr_state?.last_reviewed_at
        ? new Date(s.sr_state.last_reviewed_at)
        : null,
      defaultSessionMinutes: s.default_session_minutes,
    })),
    new Date()
  );

  const topRec = recommendations.length > 0 ? recommendations[0] : null;

  const refreshData = useCallback(async () => {
    const { data: newSkills } = await supabase
      .from("skills")
      .select("*, sr_state(*)")
      .is("archived_at", null)
      .order("created_at", { ascending: true });

    const { data: newTopics } = await supabase
      .from("topics")
      .select("*")
      .is("archived_at", null)
      .order("created_at", { ascending: true });

    const { data: newSessions } = await supabase
      .from("sessions")
      .select("*, skills!inner(name)")
      .is("skills.archived_at", null)
      .order("created_at", { ascending: false })
      .limit(10);

    if (newSkills) setSkills(newSkills);
    if (newTopics) setTopics(newTopics);
    if (newSessions) setSessions(newSessions);
  }, [supabase]);

  const handleRemoveSkill = useCallback(
    async (skill: Skill) => {
      const confirmed = window.confirm(
        `Remove "${skill.name}"? It will be archived and stop appearing in ` +
          `recommendations. Your logged sessions are kept.`
      );
      if (!confirmed) return;

      await supabase
        .from("skills")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", skill.id);
      refreshData();
    },
    [supabase, refreshData]
  );

  const handleRemoveTopic = useCallback(
    async (topic: Topic) => {
      const confirmed = window.confirm(
        `Remove topic "${topic.name}"? Its skills are kept but become ` +
          `ungrouped. Your logged sessions are kept.`
      );
      if (!confirmed) return;

      await supabase
        .from("topics")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", topic.id);
      refreshData();
    },
    [supabase, refreshData]
  );

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function renderSkill(skill: Skill) {
    if (editingSkillId === skill.id) {
      return (
        <SkillForm
          key={skill.id}
          skill={{
            id: skill.id,
            name: skill.name,
            description: skill.description,
            default_session_minutes: skill.default_session_minutes,
            topic_id: skill.topic_id,
          }}
          topics={topicOptions}
          onCreated={() => {
            setEditingSkillId(null);
            refreshData();
          }}
          onCancel={() => setEditingSkillId(null)}
        />
      );
    }

    return (
      <div
        key={skill.id}
        className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between"
      >
        <div>
          <p className="font-medium text-gray-900 text-sm">{skill.name}</p>
          {skill.description && (
            <p className="text-xs text-gray-500 mt-0.5">{skill.description}</p>
          )}
          <div className="flex gap-3 mt-1 text-xs text-gray-400">
            <span>Interval: {skill.sr_state?.interval_days ?? 0}d</span>
            <span>EF: {skill.sr_state?.ease_factor ?? "2.50"}</span>
            <span>Reps: {skill.sr_state?.repetitions ?? 0}</span>
            {skill.sr_state?.due_at && (
              <span>
                Due: {new Date(skill.sr_state.due_at).toLocaleDateString()}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditingSkillId(skill.id)}
            className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-3 py-1.5"
          >
            Edit
          </button>
          <button
            onClick={() => handleRemoveSkill(skill)}
            className="text-xs text-gray-400 hover:text-red-600 border border-gray-200 rounded px-3 py-1.5"
          >
            Remove
          </button>
          <button
            onClick={() => setLoggingSkillId(skill.id)}
            className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-3 py-1.5"
          >
            Log session
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">interleave</h1>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">{user.email}</span>
            <button
              onClick={handleSignOut}
              className="text-sm text-gray-400 hover:text-gray-600"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-8">
        {/* Recommendation */}
        {topRec && (topRec.isNew || topRec.priorityScore > 0) && (
          <RecommendationCard
            recommendation={topRec}
            onStartSession={() => setLoggingSkillId(topRec.skillId)}
          />
        )}

        {/* Skills, grouped by topic */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Skills</h2>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setShowTopicForm(true)}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                + Add topic
              </button>
              <button
                onClick={() => {
                  setSkillFormTopicId(null);
                  setShowSkillForm(true);
                }}
                className="text-sm text-gray-600 hover:text-gray-900"
              >
                + Add skill
              </button>
            </div>
          </div>

          {showTopicForm && (
            <TopicForm
              onSaved={() => {
                setShowTopicForm(false);
                refreshData();
              }}
              onCancel={() => setShowTopicForm(false)}
            />
          )}

          {showSkillForm && (
            <SkillForm
              topics={topicOptions}
              defaultTopicId={skillFormTopicId}
              onCreated={() => {
                setShowSkillForm(false);
                refreshData();
              }}
              onCancel={() => setShowSkillForm(false)}
            />
          )}

          {skills.length === 0 && topics.length === 0 && !showSkillForm ? (
            <p className="text-sm text-gray-400">
              No skills yet. Add one to get started.
            </p>
          ) : (
            <div className="space-y-6">
              {/* Each topic group */}
              {topics.map((topic) => {
                const topicSkills = skills.filter(
                  (s) => s.topic_id === topic.id
                );
                if (editingTopicId === topic.id) {
                  return (
                    <TopicForm
                      key={topic.id}
                      topic={topic}
                      onSaved={() => {
                        setEditingTopicId(null);
                        refreshData();
                      }}
                      onCancel={() => setEditingTopicId(null)}
                    />
                  );
                }
                return (
                  <div key={topic.id}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-800">
                          {topic.name}
                        </h3>
                        {topic.description && (
                          <p className="text-xs text-gray-500">
                            {topic.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setSkillFormTopicId(topic.id);
                            setShowSkillForm(true);
                          }}
                          className="text-xs text-gray-500 hover:text-gray-800"
                        >
                          + Skill
                        </button>
                        <button
                          onClick={() => setEditingTopicId(topic.id)}
                          className="text-xs text-gray-500 hover:text-gray-800"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleRemoveTopic(topic)}
                          className="text-xs text-gray-400 hover:text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {topic.notes && (
                      <p className="text-xs text-gray-400 whitespace-pre-wrap mb-2 border-l-2 border-gray-200 pl-2">
                        {topic.notes}
                      </p>
                    )}
                    {topicSkills.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">
                        No skills in this topic yet.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {topicSkills.map(renderSkill)}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Ungrouped skills */}
              {(() => {
                const topicIds = new Set(topics.map((t) => t.id));
                const ungrouped = skills.filter(
                  (s) => !s.topic_id || !topicIds.has(s.topic_id)
                );
                if (ungrouped.length === 0) return null;
                return (
                  <div>
                    {topics.length > 0 && (
                      <h3 className="text-sm font-semibold text-gray-800 mb-2">
                        Ungrouped
                      </h3>
                    )}
                    <div className="space-y-2">
                      {ungrouped.map(renderSkill)}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
        </section>

        {/* Session logging modal */}
        {loggingSkillId && (() => {
          const currentIndex = recommendations.findIndex(
            (r) => r.skillId === loggingSkillId
          );
          const nextRec = recommendations.find(
            (r, i) => i !== currentIndex && r.skillId !== loggingSkillId
          );
          return (
            <SessionForm
              skillId={loggingSkillId}
              skillName={
                skills.find((s) => s.id === loggingSkillId)?.name ?? ""
              }
              defaultMinutes={
                skills.find((s) => s.id === loggingSkillId)
                  ?.default_session_minutes ?? 25
              }
              nextSkillName={nextRec?.skillName ?? null}
              onSwitchToNext={
                nextRec
                  ? () => {
                      refreshData();
                      setLoggingSkillId(nextRec.skillId);
                    }
                  : undefined
              }
              onLogged={() => {
                setLoggingSkillId(null);
                refreshData();
              }}
              onCancel={() => setLoggingSkillId(null)}
            />
          );
        })()}

        {/* Recent sessions */}
        {sessions.length > 0 && (
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-4">
              Recent sessions
            </h2>
            <div className="space-y-2">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  className="bg-white rounded-lg border border-gray-200 p-3 flex items-center justify-between text-sm"
                >
                  <div>
                    <span className="font-medium text-gray-900">
                      {session.skills?.name}
                    </span>
                    <span className="text-gray-400 ml-2">
                      {session.duration_minutes}min
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-gray-500">
                      Quality: {session.quality}/5
                    </span>
                    <span className="text-xs text-gray-400">
                      {new Date(session.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* All recommendations (transparent reasoning) */}
        {recommendations.length > 1 && (
          <section>
            <h2 className="text-base font-semibold text-gray-900 mb-4">
              All skills — scheduler reasoning
            </h2>
            <div className="space-y-2">
              {recommendations.map((rec) => (
                <div
                  key={rec.skillId}
                  className="bg-white rounded-lg border border-gray-200 p-3 text-sm"
                >
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-gray-900">
                      {rec.skillName}
                    </span>
                    <span className="text-xs text-gray-400">
                      Priority: {rec.isNew ? "∞ (new)" : rec.priorityScore}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {formatReasonText(rec)}
                  </p>
                  {!rec.isNew && (
                    <div className="flex gap-3 mt-1 text-xs text-gray-400">
                      <span>R = {Math.round(rec.retrievability * 100)}%</span>
                      <span>
                        Last: {rec.daysSinceReview}d ago
                      </span>
                      <span>Interval: {rec.intervalDays}d</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
