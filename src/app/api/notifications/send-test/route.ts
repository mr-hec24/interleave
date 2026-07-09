import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rankSkills, R_THRESHOLD } from "@/lib/scheduler";
import { healthFromRec, retrPct } from "@/lib/health";
import { buildReminderEmail, buildSubject, type DueSkill } from "@/emails/reminderEmail";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://interleaf.app";
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS ?? "Interleaf <noreply@resend.dev>";

export async function POST() {
  // Authenticate via session cookie — no CRON_SECRET needed
  const sessionClient = await createClient();
  const { data: { user } } = await sessionClient.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = createAdminClient();

  const { data: profile } = await db
    .from("profiles")
    .select("display_name, email, unsubscribe_token, notifications_enabled")
    .eq("id", user.id)
    .single();

  if (!profile?.email) {
    return NextResponse.json({ error: "No email address on file" }, { status: 400 });
  }

  if (!profile.notifications_enabled) {
    return NextResponse.json({ error: "Email reminders are disabled" }, { status: 400 });
  }

  const { data: skills } = await db
    .from("skills")
    .select("id, name, default_session_minutes, sr_state(interval_days, last_reviewed_at)")
    .eq("user_id", user.id)
    .is("archived_at", null);

  const recs = rankSkills(
    (skills ?? []).map((s) => {
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

  // For the test email, include all skills (not just due ones) so you always get a preview
  const dueRecs = recs.filter((r) => r.isNew || r.retrievability < R_THRESHOLD);
  const previewRecs = dueRecs.length > 0 ? dueRecs.slice(0, 5) : recs.slice(0, 3);

  if (previewRecs.length === 0) {
    return NextResponse.json({ error: "No skills to show — add some skills first" }, { status: 400 });
  }

  const dueSkills: DueSkill[] = previewRecs.map((r) => ({
    name: r.skillName,
    health: healthFromRec(r),
    retrievabilityPct: r.isNew ? null : retrPct(r),
    isNew: r.isNew,
  }));

  const subject = `[Test] ${buildSubject(dueSkills)}`;
  const html = buildReminderEmail({
    displayName: profile.display_name,
    dueSkills,
    appUrl: APP_URL,
    unsubscribeToken: profile.unsubscribe_token,
  });

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { error: "RESEND_API_KEY is not set — add it in Vercel → Settings → Environment Variables, then redeploy" },
      { status: 500 }
    );
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: [profile.email],
    subject,
    html,
  });

  if (error) {
    console.error("[send-test] Resend error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, sentTo: profile.email });
}
