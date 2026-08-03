"use client";

import { useState, useCallback, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { RankedSkill, ExcludedSkill } from "@/lib/v1/controller";
import {
  healthFromRanked,
  retrPct,
  formatUtilityReason,
  exclusionCopy,
} from "@/lib/health";
import SkillForm from "./SkillForm";
import PracticeSession from "./PracticeSession";
import TopicForm from "./TopicForm";
import Plant from "./Plant";
import ThemeToggle from "./ThemeToggle";
import OnboardingModal from "./OnboardingModal";
import PromptEditor from "./PromptEditor";
import ImportPanel from "./ImportPanel";
import UtilityBreakdown from "./UtilityBreakdown";

interface Skill {
  id: string;
  name: string;
  description: string | null;
  topic_id: string | null;
}

interface Topic {
  id: string;
  name: string;
  description: string | null;
  notes: string | null;
}

export interface SkillMeta {
  id: string;
  name: string;
  stability: number | null;
  lastReviewedAt: string | null;
  promptPoolSize: number;
  daysUntilDue: number;
}

interface RecentReview {
  id: number;
  ts: string;
  skill_id: string | null;
  grade: string | null;
}

interface DashboardProps {
  user: User;
  skills: Skill[];
  topics: Topic[];
  ranked: RankedSkill[];
  excluded: ExcludedSkill[];
  skillMeta: SkillMeta[];
  epsilon: number;
  recentReviews: RecentReview[];
}

const HEALTH_GLYPH = { strong: "●", fading: "◑", overdue: "△", flowering: "✿" } as const;

function comebackLabel(daysUntil: number): string {
  const date = new Date();
  date.setDate(date.getDate() + Math.max(1, Math.ceil(daysUntil)));
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return "tomorrow";
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default function Dashboard({
  user,
  skills,
  topics,
  ranked,
  excluded,
  skillMeta,
  epsilon,
  recentReviews,
}: DashboardProps) {
  const router = useRouter();
  const [view, setView] = useState<"garden" | "data">("garden");
  const [showSkillForm, setShowSkillForm] = useState(false);
  const [skillFormTopicId, setSkillFormTopicId] = useState<string | null>(null);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [showTopicForm, setShowTopicForm] = useState(false);
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [sessionSkillId, setSessionSkillId] = useState<string | null>(null);
  const [editingPromptsSkillId, setEditingPromptsSkillId] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(
    skills.length === 0 && topics.length === 0
  );
  const [notifEnabled, setNotifEnabled] = useState(true);
  const supabase = createClient();

  const metaById = new Map(skillMeta.map((m) => [m.id, m]));
  const rankedById = new Map(ranked.map((r) => [r.skillId, r]));
  const nameFor = (id: string) => metaById.get(id)?.name ?? "";
  const topRec = ranked[0] ?? null;

  const refresh = useCallback(() => router.refresh(), [router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("profiles")
        .select("notifications_enabled")
        .eq("id", user.id)
        .single();
      if (!cancelled && data) setNotifEnabled(data.notifications_enabled ?? true);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, user.id]);

  // "Nothing is worth interrupting for" — every candidate scores below the margin
  // that would justify starting a block. Not the same as having no skills.
  const restingNow =
    ranked.length > 0 && ranked.every((r) => r.utility < epsilon);

  const nextDue = restingNow
    ? skillMeta
        .filter((m) => rankedById.has(m.id))
        .reduce<SkillMeta | null>(
          (soonest, m) => (!soonest || m.daysUntilDue < soonest.daysUntilDue ? m : soonest),
          null
        )
    : null;

  const avgRetr =
    ranked.length > 0
      ? Math.round((ranked.reduce((a, r) => a + r.retrievability, 0) / ranked.length) * 100)
      : null;
  const floweringCount = ranked.filter(
    (r) => healthFromRanked({ ...r, stability: metaById.get(r.skillId)?.stability }) === "flowering"
  ).length;

  const handleOnboardingComplete = useCallback(
    async ({ topicName, skillName }: { topicName: string; skillName: string }) => {
      const {
        data: { user: u },
      } = await supabase.auth.getUser();
      if (!u) return;
      const { data: newTopic } = await supabase
        .from("topics")
        .insert({ user_id: u.id, name: topicName })
        .select()
        .single();
      if (newTopic) {
        const { data: newSkill } = await supabase
          .from("skills")
          .insert({ user_id: u.id, name: skillName, topic_id: newTopic.id })
          .select("id")
          .single();
        // A skill with no cue isn't schedulable, so onboarding seeds a placeholder
        // and points the learner at the cue editor rather than creating something
        // that silently never appears.
        if (newSkill) {
          await supabase.from("retrieval_prompts").insert({
            user_id: u.id,
            skill_id: newSkill.id,
            text: `Recall and practise: ${skillName}`,
            source: "migrated",
          });
        }
      }
      setShowOnboarding(false);
      refresh();
    },
    [supabase, refresh]
  );

  const archiveSkill = useCallback(
    async (skill: Skill) => {
      if (
        !window.confirm(
          `Remove "${skill.name}"? It stops appearing in the rotation, and everything you've logged against it is kept.`
        )
      )
        return;
      await supabase
        .from("skills")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", skill.id);
      refresh();
    },
    [supabase, refresh]
  );

  const archiveTopic = useCallback(
    async (topic: Topic) => {
      if (
        !window.confirm(
          `Remove topic "${topic.name}"? Its skills are kept but become ungrouped.`
        )
      )
        return;
      await supabase
        .from("topics")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", topic.id);
      refresh();
    },
    [supabase, refresh]
  );

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  function plantFor(skill: Skill, size: number) {
    const rec = rankedById.get(skill.id);
    const meta = metaById.get(skill.id);
    const health = rec
      ? healthFromRanked({ ...rec, stability: meta?.stability })
      : "overdue";
    return (
      <Plant
        health={health}
        label={skill.name}
        retr={rec ? retrPct(rec) : 0}
        days={null}
        interval={0}
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
      {showOnboarding && <OnboardingModal onComplete={handleOnboardingComplete} />}

      <header className="bg-surface border-b border-edge">
        <div className="max-w-5xl mx-auto h-16 px-6 flex items-center justify-between">
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
            <span className="font-round font-semibold text-2xl text-ink">interleaf</span>
          </div>

          <div className="hidden md:flex items-center gap-4">
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
                    view === v ? "bg-green text-on-green" : "text-ink-soft hover:text-ink"
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

          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg text-ink-soft hover:text-ink hover:bg-surface-2"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              {menuOpen ? (
                <path d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
              ) : (
                <path fillRule="evenodd" clipRule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
              )}
            </svg>
          </button>
        </div>

        {menuOpen && (
          <div className="md:hidden border-t border-edge px-6 py-4 flex flex-col gap-4">
            <div
              role="tablist"
              aria-label="Dashboard view"
              className="flex bg-surface-2 border border-edge rounded-full p-1 self-start"
            >
              {(["garden", "data"] as const).map((v) => (
                <button
                  key={v}
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => {
                    setView(v);
                    setMenuOpen(false);
                  }}
                  className={`text-sm font-semibold px-4 py-1.5 rounded-full capitalize transition-colors ${
                    view === v ? "bg-green text-on-green" : "text-ink-soft hover:text-ink"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <ThemeToggle />
              <button
                onClick={handleSignOut}
                className="text-sm font-medium text-ink-soft hover:text-ink"
              >
                Sign out
              </button>
            </div>
          </div>
        )}
      </header>

      <main className="max-w-5xl mx-auto px-6 py-7 grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-7">
        <div className="space-y-7">
          {restingNow ? (
            <div className="bg-tint border border-tint-border rounded-2xl p-6 sm:p-7">
              <div className="inline-flex items-center gap-2 bg-surface/60 rounded-full px-3 py-1 mb-3">
                <span className="text-sm" aria-hidden="true">✿</span>
                <span className="text-[11px] font-bold tracking-wide uppercase text-tint-ink">
                  Nothing worth interrupting for
                </span>
              </div>
              <div className="font-display font-semibold text-2xl sm:text-3xl text-ink leading-tight">
                You&apos;re done for now
              </div>
              <p className="text-[15px] text-ink-soft mt-2 leading-relaxed">
                Every skill still scores below the margin that would justify a
                block. Rest — consolidation happens between sessions, not during
                them, and retrieving something you already have teaches almost
                nothing.
              </p>
              {nextDue && (
                <p className="text-sm font-medium text-tint-ink mt-4 bg-surface/60 rounded-xl px-4 py-3 inline-block">
                  Come back {comebackLabel(nextDue.daysUntilDue)} —{" "}
                  <span className="font-semibold">{nextDue.name}</span> decays into
                  range first.
                </p>
              )}
            </div>
          ) : topRec ? (
            <div className="bg-tint border border-tint-border rounded-2xl p-6 sm:p-7 flex flex-col sm:flex-row gap-6 items-center">
              <div className="flex-shrink-0">
                {plantFor(skills.find((s) => s.id === topRec.skillId)!, 86)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="inline-flex items-center gap-2 bg-surface/60 rounded-full px-3 py-1 mb-2.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green" />
                  <span className="text-[11px] font-bold tracking-wide uppercase text-tint-ink">
                    Practise this next
                  </span>
                </div>
                <div className="font-display font-semibold text-2xl sm:text-3xl text-ink leading-tight">
                  {topRec.skillName}
                </div>
                <p className="text-[15px] text-ink-soft mt-2 leading-relaxed">
                  {formatUtilityReason(topRec, epsilon)}
                </p>
                <div className="flex items-center gap-3 mt-4 flex-wrap">
                  <button
                    onClick={() => setSessionSkillId(topRec.skillId)}
                    className="font-semibold text-on-green bg-green-btn rounded-xl px-5 py-3 flex items-center gap-2"
                  >
                    Start practising <span aria-hidden="true">→</span>
                  </button>
                  <span className="text-sm font-medium text-ink-mute">
                    ends when the numbers say so
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {view === "garden" && (
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display font-semibold text-xl text-ink">Your garden</h2>
                <div className="flex items-center gap-3 text-sm">
                  <button
                    onClick={() => setShowImport(true)}
                    className="text-ink-soft hover:text-ink font-medium"
                  >
                    Import
                  </button>
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
                    refresh();
                  }}
                  onCancel={() => setShowTopicForm(false)}
                />
              )}
              {showSkillForm && (
                <SkillForm
                  topics={topics.map((t) => ({ id: t.id, name: t.name }))}
                  defaultTopicId={skillFormTopicId}
                  onCreated={() => {
                    setShowSkillForm(false);
                    refresh();
                  }}
                  onCancel={() => setShowSkillForm(false)}
                />
              )}

              {skills.length === 0 && topics.length === 0 && !showSkillForm ? (
                <p className="text-sm text-ink-mute">
                  No skills yet. Import your material or plant one to get started.
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
                            refresh();
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
                        onRemove={() => archiveTopic(topic)}
                      >
                        {skills
                          .filter((s) => s.topic_id === topic.id)
                          .map((s) => (
                            <button
                              key={s.id}
                              onClick={() => setSessionSkillId(s.id)}
                              title={`Practise ${s.name}`}
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
                          onClick={() => setSessionSkillId(s.id)}
                          title={`Practise ${s.name}`}
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

          {view === "data" && (
            <section className="space-y-3">
              <div className="flex items-baseline justify-between">
                <h2 className="font-display font-semibold text-xl text-ink">
                  The real numbers
                </h2>
                <span className="text-sm text-ink-mute">
                  U = {"α"}D − {"β"}F + {"γ"}R − {"δ"}I
                </span>
              </div>
              <p className="text-xs text-ink-soft leading-relaxed">
                This is the ranking the scheduler acts on, not a summary of it. Each
                bar is one term of the utility score; the skill on top is the one it
                would pick.
              </p>

              {ranked.map((rec) => (
                <UtilityBreakdown
                  key={rec.skillId}
                  rec={rec}
                  epsilon={epsilon}
                  meta={metaById.get(rec.skillId)}
                  reason={formatUtilityReason(rec, epsilon)}
                  interferenceSourceName={
                    rec.interferenceFrom ? nameFor(rec.interferenceFrom.skillId) : null
                  }
                  onPractise={() => setSessionSkillId(rec.skillId)}
                  onEditCues={() => setEditingPromptsSkillId(rec.skillId)}
                  onEdit={() => setEditingSkillId(rec.skillId)}
                  onRemove={() => {
                    const sk = skills.find((s) => s.id === rec.skillId);
                    if (sk) archiveSkill(sk);
                  }}
                />
              ))}

              {excluded.length > 0 && (
                <div className="border border-edge rounded-xl p-4 bg-surface-2">
                  <div className="text-[11px] font-bold tracking-[0.08em] uppercase text-ink-mute mb-2">
                    Not in the rotation
                  </div>
                  <p className="text-xs text-ink-soft mb-3 leading-relaxed">
                    These are excluded outright rather than ranked low — a locked
                    skill can&apos;t be practised, and a skill with no cue can&apos;t
                    be measured.
                  </p>
                  <div className="flex flex-col gap-2">
                    {excluded.map((e) => (
                      <div
                        key={e.skillId}
                        className="flex items-baseline justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <span className="text-sm font-semibold text-ink">
                            {e.skillName}
                          </span>
                          <span className="text-xs text-ink-soft ml-2">
                            {exclusionCopy(e, nameFor)}
                          </span>
                        </div>
                        {e.reason === "no_prompts" && (
                          <button
                            onClick={() => setEditingPromptsSkillId(e.skillId)}
                            className="text-[11px] text-green-deep hover:underline font-medium flex-shrink-0"
                          >
                            Add a cue
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="space-y-4">
          <div className="bg-surface border border-edge rounded-2xl p-5">
            <div className="font-display font-semibold text-[17px] text-ink">
              {restingNow ? "All rested ✿" : "What it would pick"}
            </div>
            <p className="text-xs text-ink-mute mt-0.5 mb-3.5">
              {restingNow
                ? "Nothing scores above the margin right now."
                : "Ordered by utility — the reasoning is always visible."}
            </p>
            {ranked.length === 0 ? (
              <p className="text-xs text-ink-mute">Nothing schedulable yet.</p>
            ) : (
              <div className="flex flex-col">
                {ranked.slice(0, 6).map((rec, i, arr) => {
                  const meta = metaById.get(rec.skillId);
                  const health = healthFromRanked({ ...rec, stability: meta?.stability });
                  return (
                    <div
                      key={rec.skillId}
                      className={`flex items-center gap-3 py-2.5 ${
                        i < arr.length - 1 ? "border-b border-edge" : ""
                      }`}
                    >
                      <span aria-hidden="true" className="text-xs text-ink-soft w-3">
                        {HEALTH_GLYPH[health]}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-[13px] text-ink truncate">
                          {rec.skillName}
                        </div>
                        <div className="text-[11px] text-ink-mute">
                          {rec.utility >= epsilon
                            ? "Worth practising now"
                            : meta && meta.daysUntilDue > 0
                              ? `Rest — in range in ${Math.round(meta.daysUntilDue)}d`
                              : "Resting"}
                        </div>
                      </div>
                      <span className="font-mono text-xs text-ink-soft">
                        {retrPct(rec)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

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
                  durable skills
                </div>
              </div>
            </div>
            <p className="text-xs text-ink-soft leading-relaxed">
              Interleaf rewards <b className="text-tint-ink">durable memory</b> — never
              streaks, logins, or session counts.
            </p>
          </div>

          <div className="bg-surface border border-edge rounded-2xl p-5">
            <div className="font-display font-semibold text-[17px] text-ink mb-1">
              Daily reminders
            </div>
            <p className="text-xs text-ink-mute mb-4">
              Get an email when something decays into range.
            </p>
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink">Email reminders</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={notifEnabled}
                  onChange={async (e) => {
                    const next = e.target.checked;
                    setNotifEnabled(next);
                    await supabase
                      .from("profiles")
                      .update({ notifications_enabled: next })
                      .eq("id", user.id);
                  }}
                />
                <div
                  className={`w-11 h-6 rounded-full transition-colors duration-200 ${
                    notifEnabled ? "bg-green" : "bg-edge"
                  }`}
                />
                <div
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    notifEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </label>
            </div>
          </div>

          {recentReviews.length > 0 && (
            <div className="bg-surface border border-edge rounded-2xl p-5">
              <div className="font-display font-semibold text-[17px] text-ink mb-3">
                Recent retrievals
              </div>
              <div className="flex flex-col">
                {recentReviews.map((r, i, arr) => (
                  <div
                    key={r.id}
                    className={`flex items-center justify-between py-2 text-sm ${
                      i < arr.length - 1 ? "border-b border-edge" : ""
                    }`}
                  >
                    <span className="font-medium text-ink truncate">
                      {r.skill_id ? nameFor(r.skill_id) : "—"}
                    </span>
                    <span className="text-xs text-ink-mute">{r.grade}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </main>

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
                  topic_id: skills.find((s) => s.id === editingSkillId)?.topic_id ?? null,
                }}
                topics={topics.map((t) => ({ id: t.id, name: t.name }))}
                onCreated={() => {
                  setEditingSkillId(null);
                  refresh();
                }}
                onCancel={() => setEditingSkillId(null)}
              />
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <ImportPanel
          topics={topics.map((t) => ({ id: t.id, name: t.name }))}
          onImported={() => {
            setShowImport(false);
            refresh();
          }}
          onCancel={() => setShowImport(false)}
        />
      )}

      {editingPromptsSkillId && (
        <PromptEditor
          skillId={editingPromptsSkillId}
          skillName={nameFor(editingPromptsSkillId)}
          onClose={() => setEditingPromptsSkillId(null)}
          onChanged={refresh}
        />
      )}

      {sessionSkillId && (
        <PracticeSession
          key={sessionSkillId}
          initialSkillId={sessionSkillId}
          onExit={() => {
            setSessionSkillId(null);
            refresh();
          }}
        />
      )}
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
  const hasPlants = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="group bg-surface-2 border border-edge rounded-2xl pt-4 px-2 overflow-hidden">
      <div className="flex items-end justify-center gap-1 min-h-[140px]">
        {hasPlants ? (
          children
        ) : (
          <span className="text-xs text-ink-mute self-center mb-10">No skills yet</span>
        )}
      </div>
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
          <span className="text-[13px] font-semibold text-white px-2 truncate">{name}</span>
        </div>
      </div>
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
