import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Dashboard from "@/components/Dashboard";
import { loadSessionContext } from "@/lib/v1/session/context";
import { rankSkills } from "@/lib/v1/controller";
import { daysUntilRetrievability } from "@/lib/v1/memory";

/**
 * The dashboard renders the same ranking the scheduler acts on.
 *
 * It is computed here, from the same `loadSessionContext` + `rankSkills` path a
 * session uses, rather than being re-derived in the component from a different set
 * of columns. That is the whole point: the design's trust argument rests on the
 * learner seeing the actual reasoning, and a second implementation of the ranking
 * would eventually disagree with the first.
 */
export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const now = new Date();
  const [ctx, topicsRes, recentRes] = await Promise.all([
    loadSessionContext(supabase, user.id, now),
    supabase
      .from("topics")
      .select("*")
      .is("archived_at", null)
      .order("created_at", { ascending: true }),
    supabase
      .from("events")
      .select("id, ts, skill_id, grade, event_type")
      .eq("user_id", user.id)
      .eq("event_type", "review")
      .order("ts", { ascending: false })
      .limit(8),
  ]);

  const { ranked, excluded } = rankSkills({
    skills: ctx.skills,
    now,
    config: ctx.config,
    saturation: ctx.saturation,
    prereqEdges: ctx.prereqEdges,
    similarityGraph: ctx.similarityGraph,
    // A fresh page load is not mid-session, so nothing is in the interference
    // window. Showing a penalty here would be showing a state that isn't live.
    recentPractice: [],
  });

  const skillMeta = ctx.skills.map((s) => ({
    id: s.id,
    name: s.name,
    stability: s.stability,
    lastReviewedAt: s.lastReviewedAt?.toISOString() ?? null,
    promptPoolSize: s.promptPoolSize,
    /** Days until R decays to the review threshold; negative when already there. */
    daysUntilDue:
      s.stability === null || s.lastReviewedAt === null
        ? 0
        : (daysUntilRetrievability(ctx.config.theta, s.stability) ?? 0) -
          (now.getTime() - s.lastReviewedAt.getTime()) / 86400000,
  }));

  const { data: skillRows } = await supabase
    .from("skills")
    .select("id, name, description, topic_id")
    .is("archived_at", null)
    .order("created_at", { ascending: true });

  return (
    <Dashboard
      user={user}
      skills={skillRows ?? []}
      topics={topicsRes.data ?? []}
      ranked={ranked}
      excluded={excluded}
      skillMeta={skillMeta}
      epsilon={ctx.config.epsilon}
      recentReviews={recentRes.data ?? []}
    />
  );
}
