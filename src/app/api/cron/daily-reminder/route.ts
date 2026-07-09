import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createAdminClient } from "@/lib/supabase/admin";
import { rankSkills, R_THRESHOLD } from "@/lib/scheduler";
import { healthFromRec, retrPct } from "@/lib/health";
import { buildReminderEmail, buildSubject, type DueSkill } from "@/emails/reminderEmail";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://interleaf.app";
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS ?? "Interleaf <noreply@resend.dev>";

// Vercel injects Authorization: Bearer <CRON_SECRET> on cron invocations.
function isAuthorized(request: Request): boolean {
  const auth = request.headers.get("authorization") ?? "";
  return auth === `Bearer ${process.env.CRON_SECRET}`;
}

function localHourForTimezone(timezone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hour12: false,
      timeZone: timezone,
    }).formatToParts(new Date());
    const h = parts.find((p) => p.type === "hour");
    return parseInt(h?.value ?? "0", 10);
  } catch {
    return new Date().getUTCHours();
  }
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
    .select("id, email, display_name, notification_hour, notification_timezone, unsubscribe_token, last_notification_sent_at")
    .eq("notifications_enabled", true)
    .not("email", "is", null);

  if (profilesError) {
    console.error("[cron] profiles query failed:", profilesError.message);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }

  const results: { userId: string; status: string }[] = [];

  for (const profile of profiles ?? []) {
    const localHour = localHourForTimezone(profile.notification_timezone ?? "UTC");

    // In dev, skip hour filter so the route always fires for easy testing
    if (!isDev && localHour !== (profile.notification_hour ?? 8)) continue;

    // Skip if we already sent one in the past 20 hours
    if (alreadySentToday(profile.last_notification_sent_at)) {
      results.push({ userId: profile.id, status: "already_sent_today" });
      continue;
    }

    // Fetch this user's active skills with SR state
    const { data: skills } = await db
      .from("skills")
      .select("id, name, default_session_minutes, sr_state(interval_days, last_reviewed_at)")
      .eq("user_id", profile.id)
      .is("archived_at", null);

    if (!skills || skills.length === 0) {
      results.push({ userId: profile.id, status: "no_skills" });
      continue;
    }

    const recs = rankSkills(
      skills.map((s) => {
        const sr = Array.isArray(s.sr_state) ? s.sr_state[0] : s.sr_state;
        return {
          skillId: s.id,
          skillName: s.name,
          intervalDays: sr?.interval_days ?? 0,
          lastReviewedAt: sr?.last_reviewed_at ? new Date(sr.last_reviewed_at) : null,
          defaultSessionMinutes: s.default_session_minutes,
        };
      }),
      new Date()
    );

    const dueRecs = recs.filter((r) => r.isNew || r.retrievability < R_THRESHOLD);
    if (dueRecs.length === 0) {
      results.push({ userId: profile.id, status: "nothing_due" });
      continue;
    }

    // Cap at 5 skills in the email to avoid overwhelming
    const topDue = dueRecs.slice(0, 5);
    const dueSkills: DueSkill[] = topDue.map((r) => ({
      name: r.skillName,
      health: healthFromRec(r),
      retrievabilityPct: r.isNew ? null : retrPct(r),
      isNew: r.isNew,
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
