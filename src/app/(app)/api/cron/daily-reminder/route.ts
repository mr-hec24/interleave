import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSessionContext } from "@/lib/v1/session/context";
import { rankSkills } from "@/lib/v1/controller";
import { healthFromRanked, retrPct } from "@/lib/health";
import { buildReminderEmail, buildSubject, type DueSkill } from "@/emails/reminderEmail";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://interleaf.app";
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS ?? "Interleaf <noreply@resend.dev>";

// Vercel injects Authorization: Bearer <CRON_SECRET> on cron invocations.
function isAuthorized(request: Request): boolean {
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

function alreadySentToday(lastSentAt: string | null): boolean {
  if (!lastSentAt) return false;
  const diff = Date.now() - new Date(lastSentAt).getTime();
  return diff < 20 * 60 * 60 * 1000; // 20 hours
}

const isDev = process.env.NODE_ENV === "development";

export async function GET(request: Request) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  if (!isDev && !isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();

  // Fetch all users with notifications enabled
  const { data: profiles, error: profilesError } = await db
    .from("profiles")
    .select("id, email, display_name, unsubscribe_token, last_notification_sent_at")
    .eq("notifications_enabled", true)
    .not("email", "is", null);

  if (profilesError) {
    console.error("[cron] profiles query failed:", profilesError.message);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const results: { userId: string; status: string }[] = [];

  for (const profile of profiles ?? []) {

    // Skip if we already sent one in the past 20 hours
    if (alreadySentToday(profile.last_notification_sent_at)) {
      results.push({ userId: profile.id, status: "already_sent_today" });
      continue;
    }

    // Ranked through the same controller a live session uses. There is no session
    // in flight here, so saturation is read from its persisted value and decayed
    // forward to now — the reminder ranks against fatigue at its resting level
    // rather than assuming the learner is either fresh or spent.
    const now = new Date();
    const ctx = await loadSessionContext(db, profile.id, now);
    if (ctx.skills.length === 0) {
      results.push({ userId: profile.id, status: "no_skills" });
      continue;
    }

    const { ranked } = rankSkills({
      skills: ctx.skills,
      now,
      config: ctx.config,
      saturation: ctx.saturation,
      prereqEdges: ctx.prereqEdges,
      similarityGraph: ctx.similarityGraph,
      // Nobody is mid-session, so nothing sits in the interference window.
      recentPractice: [],
    });

    // Only mail when something clears the margin that would justify interrupting
    // the learner's day. Below it, the scheduler's own reckoning is that there is
    // nothing worth doing — and a reminder that contradicts the app's advice is
    // worse than no reminder.
    const dueRecs = ranked.filter((r) => r.utility >= ctx.config.epsilon);
    if (dueRecs.length === 0) {
      results.push({ userId: profile.id, status: "nothing_due" });
      continue;
    }

    // Cap at 5 skills in the email to avoid overwhelming
    const topDue = dueRecs.slice(0, 5);
    const dueSkills: DueSkill[] = topDue.map((r) => ({
      name: r.skillName,
      health: healthFromRanked(r),
      retrievabilityPct: retrPct(r),
      isNew: r.retrievability === 0,
    }));

    const subject = buildSubject(dueSkills);
    const html = buildReminderEmail({
      displayName: profile.display_name,
      dueSkills,
      appUrl: APP_URL,
      unsubscribeToken: profile.unsubscribe_token,
    });

    const { error: sendError } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [profile.email],
      subject,
      html,
    });

    if (sendError) {
      console.error(`[cron] send failed for ${profile.id}:`, sendError.message);
      results.push({ userId: profile.id, status: "send_failed" });
      continue;
    }

    await db
      .from("profiles")
      .update({ last_notification_sent_at: new Date().toISOString() })
      .eq("id", profile.id);

    results.push({ userId: profile.id, status: "sent" });
  }

  const summary = results.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({ ok: true, processed: results.length, summary });
}
