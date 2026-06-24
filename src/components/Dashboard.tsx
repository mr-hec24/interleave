"use client";

import { useState, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { rankSkills, formatReasonText } from "@/lib/scheduler";
import type { SchedulerRecommendation } from "@/lib/scheduler";
import SkillForm from "./SkillForm";
import SessionForm from "./SessionForm";
import RecommendationCard from "./RecommendationCard";

interface Skill {
  id: string;
  name: string;
  description: string | null;
  default_session_minutes: number;
  sr_state: {
    repetitions: number;
    ease_factor: number;
    interval_days: number;
    last_reviewed_at: string | null;
    due_at: string | null;
  } | null;
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
  recentSessions: Session[];
}

export default function Dashboard({
  user,
  skills: initialSkills,
  recentSessions: initialSessions,
}: DashboardProps) {
  const [skills, setSkills] = useState(initialSkills);
  const [sessions, setSessions] = useState(initialSessions);
  const [showSkillForm, setShowSkillForm] = useState(false);
  const [loggingSkillId, setLoggingSkillId] = useState<string | null>(null);
  const supabase = createClient();

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

    const { data: newSessions } = await supabase
      .from("sessions")
      .select("*, skills(name)")
      .order("created_at", { ascending: false })
      .limit(10);

    if (newSkills) setSkills(newSkills);
    if (newSessions) setSessions(newSessions);
  }, [supabase]);

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
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

        {/* Skills */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Skills</h2>
            <button
              onClick={() => setShowSkillForm(true)}
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              + Add skill
            </button>
          </div>

          {showSkillForm && (
            <SkillForm
              onCreated={() => {
                setShowSkillForm(false);
                refreshData();
              }}
              onCancel={() => setShowSkillForm(false)}
            />
          )}

          {skills.length === 0 && !showSkillForm ? (
            <p className="text-sm text-gray-400">
              No skills yet. Add one to get started.
            </p>
          ) : (
            <div className="space-y-2">
              {skills.map((skill) => (
                <div
                  key={skill.id}
                  className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between"
                >
                  <div>
                    <p className="font-medium text-gray-900 text-sm">
                      {skill.name}
                    </p>
                    {skill.description && (
                      <p className="text-xs text-gray-500 mt-0.5">
                        {skill.description}
                      </p>
                    )}
                    <div className="flex gap-3 mt-1 text-xs text-gray-400">
                      <span>
                        Interval: {skill.sr_state?.interval_days ?? 0}d
                      </span>
                      <span>
                        EF: {skill.sr_state?.ease_factor ?? "2.50"}
                      </span>
                      <span>
                        Reps: {skill.sr_state?.repetitions ?? 0}
                      </span>
                      {skill.sr_state?.due_at && (
                        <span>
                          Due:{" "}
                          {new Date(skill.sr_state.due_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setLoggingSkillId(skill.id)}
                    className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-3 py-1.5"
                  >
                    Log session
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Session logging modal */}
        {loggingSkillId && (
          <SessionForm
            skillId={loggingSkillId}
            skillName={
              skills.find((s) => s.id === loggingSkillId)?.name ?? ""
            }
            defaultMinutes={
              skills.find((s) => s.id === loggingSkillId)
                ?.default_session_minutes ?? 25
            }
            onLogged={() => {
              setLoggingSkillId(null);
              refreshData();
            }}
            onCancel={() => setLoggingSkillId(null)}
          />
        )}

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
