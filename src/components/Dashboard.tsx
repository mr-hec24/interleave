"use client";

import { useState, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { rankSkills, formatReasonText } from "@/lib/scheduler";
import type { SchedulerRecommendation } from "@/lib/scheduler";
import { healthFromRec, retrPct } from "@/lib/health";
import SkillForm from "./SkillForm";
import SessionForm from "./SessionForm";
import TopicForm from "./TopicForm";
import Plant from "./Plant";
import ThemeToggle from "./ThemeToggle";

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

const HEALTH_GLYPH = { strong: "●", fading: "◑", overdue: "△", flowering: "✿" } as const;

export default function Dashboard({
  user,
  skills: initialSkills,
  topics: initialTopics,
  recentSessions: initialSessions,
}: DashboardProps) {
  const [skills, setSkills] = useState(initialSkills);
  const [topics, setTopics] = useState(initialTopics);
  const [sessions, setSessions] = useState(initialSessions);
  const [view, setView] = useState<"garden" | "data">("garden");
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

  const recById = new Map(recommendations.map((r) => [r.skillId, r]));
  const topRec = recommendations.length > 0 ? recommendations[0] : null;

  // Garden-health stats
  const reviewed = recommendations.filter((r) => !r.isNew);
  const avgRetr =
    reviewed.length > 0
      ? Math.round(
          (reviewed.reduce((a, r) => a + r.retrievability, 0) / reviewed.length) * 100
        )
      : null;
  const floweringCount = recommendations.filter(
    (r) => healthFromRec(r) === "flowering"
  ).length;

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
      if (
        !window.confirm(
          `Remove "${skill.name}"? It will be archived and stop appearing in ` +
            `recommendations. Your logged sessions are kept.`
        )
      )
        return;
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
      if (
        !window.confirm(
          `Remove topic "${topic.name}"? Its skills are kept but become ` +
            `ungrouped. Your logged sessions are kept.`
        )
      )
        return;
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

  function plantFor(skill: Skill, size: number) {
    const rec = recById.get(skill.id);
    if (!rec) return null;
    return (
      <Plant
        health={healthFromRec(rec)}
        label={skill.name}
        retr={retrPct(rec)}
        days={rec.daysSinceReview}
        interval={rec.intervalDays}
        size={size}
        showText={false}
      />
    );
  }

  const ungrouped = skills.filter(
    (s) => !s.topic_id || !topics.some((t) => t.id === s.topic_id)
  );

  return (
    <div className="min-h-screen bg-paper">
      {/* Header */}
      <header className="h-16 bg-surface border-b border-edge">
        <div className="max-w-5xl mx-auto h-full px-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <svg width="26" height="26" viewBox="0 0 120 120" aria-hidden="true">
              <path
                d="M47.58,13.64 C 89.97,25.06 102.39,71.42 72.42,106.36 C 28.99,91.08 16.57,44.72 47.58,13.64 Z"
                fill="var(--green)"
              />
              <path
                d="M71.39,102.50 C 51.66,82.94 71.45,48.65 49.13,19.43"
                fill="none"
                stroke="var(--surface)"
                strokeWidth="5"
                strokeLinecap="round"
              />
            </svg>
            <span className="font-round font-semibold text-2xl text-ink">
              interleaf
            </span>
          </div>
          <div className="flex items-center gap-4">
            <div
              role="tablist"
              aria-label="Dashboard view"
              className="flex bg-surface-2 border border-edge rounded-full p-1"
            >
              {(["garden", "data"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={`text-sm font-semibold px-4 py-1.5 rounded-full capitalize transition-colors ${
                    view === v
                      ? "bg-green text-on-green"
                      : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <ThemeToggle />
            <button
              onClick={handleSignOut}
              className="w-8 h-8 rounded-full bg-clay flex items-center justify-center text-sm font-semibold text-white"
              title={`${user.email} — sign out`}
              aria-label="Sign out"
            >
              {(user.email ?? "?")[0].toUpperCase()}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-7 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-7">
        {/* Left column */}
        <div className="space-y-7">
          {/* Water this next */}
          {topRec && (
            <div className="bg-tint border border-tint-border rounded-2xl p-6 sm:p-7 flex flex-col sm:flex-row gap-6 items-center">
              <div className="flex-shrink-0">{plantFor(skills.find((s) => s.id === topRec.skillId)!, 86)}</div>
              <div className="flex-1 min-w-0">
                <div className="inline-flex items-center gap-2 bg-surface/60 rounded-full px-3 py-1 mb-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green" />
                  <span className="text-[11px] font-bold tracking-wide uppercase text-tint-ink">
                    Water this next
                  </span>
                </div>
                <div className="font-display font-semibold text-2xl sm:text-3xl text-ink leading-tight">
                  {topRec.skillName}
                </div>
                <p className="text-[15px] text-ink-soft mt-2 leading-relaxed">
                  {formatReasonText(topRec)}
                </p>
                <div className="flex items-center gap-3 mt-4 flex-wrap">
                  <button
                    onClick={() => setLoggingSkillId(topRec.skillId)}
                    className="font-semibold text-on-green bg-green-btn rounded-xl px-5 py-3 flex items-center gap-2"
                  >
                    Start session <span aria-hidden="true">→</span>
                  </button>
                  <span className="text-sm font-medium text-ink-mute">
                    ≈ {topRec.sessionMinutes} min
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* GARDEN VIEW */}
          {view === "garden" && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display font-semibold text-xl text-ink">
                  Your garden
                </h2>
                <div className="flex items-center gap-3 text-sm">
                  <button
                    onClick={() => setShowTopicForm(true)}
                    className="text-ink-soft hover:text-ink font-medium"
                  >
                    + Topic
                  </button>
                  <button
                    onClick={() => {
                      setSkillFormTopicId(null);
                      setShowSkillForm(true);
                    }}
                    className="text-ink-soft hover:text-ink font-medium"
                  >
                    + Skill
                  </button>
                  <span className="text-ink-mute">
                    {topics.length} topics · {skills.length} skills
                  </span>
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
                <p className="text-sm text-ink-mute">
                  No skills yet. Plant one to get started.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {topics.map((topic) =>
                    editingTopicId === topic.id ? (
                      <div key={topic.id} className="sm:col-span-2 lg:col-span-3">
                        <TopicForm
                          topic={topic}
                          onSaved={() => {
                            setEditingTopicId(null);
                            refreshData();
                          }}
                          onCancel={() => setEditingTopicId(null)}
                        />
                      </div>
                    ) : (
                      <Planter
                        key={topic.id}
                        name={topic.name}
                        onAddSkill={() => {
                          setSkillFormTopicId(topic.id);
                          setShowSkillForm(true);
                        }}
                        onEdit={() => setEditingTopicId(topic.id)}
                        onRemove={() => handleRemoveTopic(topic)}
                      >
                        {skills
                          .filter((s) => s.topic_id === topic.id)
                          .map((s) => (
                            <button
                              key={s.id}
                              onClick={() => setLoggingSkillId(s.id)}
                              title={`Practice ${s.name}`}
                            >
                              {plantFor(s, 56)}
                            </button>
                          ))}
                      </Planter>
                    )
                  )}

                  {ungrouped.length > 0 && (
                    <Planter
                      name="Ungrouped"
                      onAddSkill={() => {
                        setSkillFormTopicId(null);
                        setShowSkillForm(true);
                      }}
                    >
                      {ungrouped.map((s) => (
                        <button
                          key={s.id}
                          onClick={() => setLoggingSkillId(s.id)}
                          title={`Practice ${s.name}`}
                        >
                          {plantFor(s, 56)}
                        </button>
                      ))}
                    </Planter>
                  )}
                </div>
              )}
            </section>
          )}

          {/* DATA VIEW */}
          {view === "data" && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-semibold text-xl text-ink">
                  The real numbers
                </h2>
                <span className="text-sm text-ink-mute">
                  Auditable scheduler reasoning
                </span>
              </div>
              {recommendations.map((rec) => {
                const health = healthFromRec(rec);
                return (
                  <div
                    key={rec.skillId}
                    className="bg-surface border border-edge rounded-xl p-4"
                  >
                    <div className="flex items-center gap-2.5">
                      <span aria-hidden="true" className="text-ink-soft text-sm">
                        {HEALTH_GLYPH[health]}
                      </span>
                      <span className="font-semibold text-sm text-ink flex-1">
                        {rec.skillName}
                      </span>
                      <span className="font-mono text-xs text-ink-soft">
                        {rec.isNew ? "new" : `${retrPct(rec)}%`}
                      </span>
                    </div>
                    <p className="text-xs text-ink-soft mt-1.5 leading-relaxed">
                      {formatReasonText(rec)}
                    </p>
                    <div className="flex items-center gap-4 mt-2">
                      {!rec.isNew && (
                        <div className="flex gap-4 font-mono text-[11px] text-ink-mute">
                          <span>R = {retrPct(rec)}%</span>
                          <span>Last: {rec.daysSinceReview}d ago</span>
                          <span>Interval: {rec.intervalDays}d</span>
                        </div>
                      )}
                      <div className="ml-auto flex gap-3 text-[11px]">
                        <button
                          onClick={() => setLoggingSkillId(rec.skillId)}
                          className="text-green-deep hover:underline font-medium"
                        >
                          Practice
                        </button>
                        <button
                          onClick={() => setEditingSkillId(rec.skillId)}
                          className="text-ink-mute hover:text-ink"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            const sk = skills.find((s) => s.id === rec.skillId);
                            if (sk) handleRemoveSkill(sk);
                          }}
                          className="text-ink-mute hover:text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </section>
          )}
        </div>

        {/* Sidebar */}
        <aside className="space-y-4">
          {/* Today's schedule */}
          <div className="bg-surface border border-edge rounded-2xl p-5">
            <div className="font-display font-semibold text-[17px] text-ink">
              Today&apos;s schedule
            </div>
            <p className="text-xs text-ink-mute mt-0.5 mb-3.5">
              Chosen by the scheduler — the reasoning is always visible.
            </p>
            {recommendations.length === 0 ? (
              <p className="text-xs text-ink-mute">Nothing scheduled yet.</p>
            ) : (
              <div className="flex flex-col">
                {recommendations.slice(0, 6).map((rec, i, arr) => {
                  const health = healthFromRec(rec);
                  return (
                    <div
                      key={rec.skillId}
                      className={`flex items-center gap-3 py-2.5 ${i < arr.length - 1 ? "border-b border-edge" : ""}`}
                    >
                      <span aria-hidden="true" className="text-xs text-ink-soft w-3">
                        {HEALTH_GLYPH[health]}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[13px] text-ink truncate">
                          {rec.skillName}
                        </div>
                        <div className="text-[11px] text-ink-mute">
                          {rec.isNew
                            ? "New — start anytime"
                            : rec.priorityScore > 0
                              ? "Due now · slipping"
                              : `Rest — due in ${Math.max(0, Math.round(rec.intervalDays - (rec.daysSinceReview ?? 0)))} days`}
                        </div>
                      </div>
                      <span className="font-mono text-xs text-ink-soft">
                        {rec.isNew ? "—" : `${retrPct(rec)}%`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Garden health */}
          <div className="bg-tint border border-tint-border rounded-2xl p-5">
            <div className="font-display font-semibold text-[17px] text-ink mb-3.5">
              Garden health
            </div>
            <div className="flex gap-2.5 mb-3.5">
              <div className="flex-1 bg-surface rounded-xl p-3">
                <div className="font-display font-bold text-2xl text-tint-ink">
                  {avgRetr === null ? "—" : `${avgRetr}%`}
                </div>
                <div className="text-[11px] font-medium text-ink-mute">
                  avg retrievability
                </div>
              </div>
              <div className="flex-1 bg-surface rounded-xl p-3">
                <div className="font-display font-bold text-2xl text-tint-ink">
                  {floweringCount} ✿
                </div>
                <div className="text-[11px] font-medium text-ink-mute">
                  flowering skills
                </div>
              </div>
            </div>
            <p className="text-xs text-ink-soft leading-relaxed">
              Interleaf rewards{" "}
              <b className="text-tint-ink">durable memory</b> — never streaks,
              logins, or session counts.
            </p>
          </div>

          {/* Recent sessions */}
          {sessions.length > 0 && (
            <div className="bg-surface border border-edge rounded-2xl p-5">
              <div className="font-display font-semibold text-[17px] text-ink mb-3">
                Recent sessions
              </div>
              <div className="flex flex-col">
                {sessions.slice(0, 5).map((s, i, arr) => (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between py-2 text-sm ${i < arr.length - 1 ? "border-b border-edge" : ""}`}
                  >
                    <span className="font-medium text-ink truncate">
                      {s.skills?.name}
                    </span>
                    <span className="text-xs text-ink-mute">
                      {s.duration_minutes}m · {s.quality}/5
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </main>

      {/* Edit-skill modal-ish (inline form) */}
      {editingSkillId && (
        <div className="fixed inset-0 bg-black/50 overflow-y-auto z-50">
          <div className="min-h-full flex items-center justify-center p-4">
            <div className="w-full max-w-md">
              <SkillForm
                skill={{
                  id: editingSkillId,
                  name: skills.find((s) => s.id === editingSkillId)?.name ?? "",
                  description:
                    skills.find((s) => s.id === editingSkillId)?.description ?? null,
                  default_session_minutes:
                    skills.find((s) => s.id === editingSkillId)
                      ?.default_session_minutes ?? 25,
                  topic_id:
                    skills.find((s) => s.id === editingSkillId)?.topic_id ?? null,
                }}
                topics={topicOptions}
                onCreated={() => {
                  setEditingSkillId(null);
                  refreshData();
                }}
                onCancel={() => setEditingSkillId(null)}
              />
            </div>
          </div>
        </div>
      )}

      {/* Session modal */}
      {loggingSkillId &&
        (() => {
          const nextRec = recommendations.find(
            (r) => r.skillId !== loggingSkillId
          );
          const skill = skills.find((s) => s.id === loggingSkillId);
          return (
            <SessionForm
              skillId={loggingSkillId}
              skillName={skill?.name ?? ""}
              defaultMinutes={skill?.default_session_minutes ?? 25}
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
    </div>
  );
}

/** A clay planter holding skill-plants, with topic actions. */
function Planter({
  name,
  children,
  onAddSkill,
  onEdit,
  onRemove,
}: {
  name: string;
  children: React.ReactNode;
  onAddSkill?: () => void;
  onEdit?: () => void;
  onRemove?: () => void;
}) {
  const hasPlants = Array.isArray(children)
    ? children.length > 0
    : Boolean(children);
  return (
    <div className="group bg-surface-2 border border-edge rounded-2xl pt-4 px-2 overflow-hidden">
      <div className="flex items-end justify-center gap-1 min-h-[140px]">
        {hasPlants ? (
          children
        ) : (
          <span className="text-xs text-ink-mute self-center mb-10">
            No skills yet
          </span>
        )}
      </div>
      {/* Clay planter base */}
      <div className="relative h-[54px] mt-0.5">
        <div
          className="absolute left-[10%] right-[10%] top-0 h-[11px] rounded-[50%]"
          style={{ background: "var(--clay)", filter: "brightness(0.8)" }}
        />
        <div
          className="absolute left-[8%] right-[8%] top-[5px] bottom-0 flex items-center justify-center"
          style={{
            clipPath: "polygon(0 0,100% 0,87% 100%,13% 100%)",
            background: "var(--clay)",
          }}
        >
          <span className="text-[13px] font-semibold text-white px-2 truncate">
            {name}
          </span>
        </div>
      </div>
      {/* Hover actions */}
      <div className="flex items-center justify-center gap-3 py-2 text-[11px] opacity-0 group-hover:opacity-100 transition-opacity">
        {onAddSkill && (
          <button onClick={onAddSkill} className="text-ink-mute hover:text-ink">
            + Skill
          </button>
        )}
        {onEdit && (
          <button onClick={onEdit} className="text-ink-mute hover:text-ink">
            Edit
          </button>
        )}
        {onRemove && (
          <button onClick={onRemove} className="text-ink-mute hover:text-red-600">
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
