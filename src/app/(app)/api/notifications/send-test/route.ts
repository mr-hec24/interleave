import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadSessionContext } from "@/lib/v1/session/context";
import { rankSkills } from "@/lib/v1/controller";
import { healthFromRanked, retrPct } from "@/lib/health";
import { buildReminderEmail, buildSubject, type DueSkill } from "@/emails/reminderEmail";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://interleaf.app";
const FROM_ADDRESS = process.env.RESEND_FROM_ADDRESS ?? "Interleaf <noreply@resend.dev>";

export async function POST() {
  try {
    return await handleSendTest();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[send-test] Uncaught error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

async function handleSendTest() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not set — add it in Vercel → Settings → Environment Variables, then redeploy" },
      { status: 500 }
    );
  }

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

  const now = new Date();
  const ctx = await loadSessionContext(db, user.id, now);
  const { ranked } = rankSkills({
    skills: ctx.skills,
    now,
    config: ctx.config,
    saturation: ctx.saturation,
    prereqEdges: ctx.prereqEdges,
    similarityGraph: ctx.similarityGraph,
    recentPractice: [],
  });

  // For the test email, fall back to whatever exists so a preview always renders.
  const dueRecs = ranked.filter((r) => r.utility >= ctx.config.epsilon);
  const previewRecs = dueRecs.length > 0 ? dueRecs.slice(0, 5) : ranked.slice(0, 3);

  if (previewRecs.length === 0) {
    return NextResponse.json({ error: "No skills to show — add some skills first" }, { status: 400 });
  }

  const dueSkills: DueSkill[] = previewRecs.map((r) => ({
    name: r.skillName,
    health: healthFromRanked(r),
    retrievabilityPct: retrPct(r),
    isNew: r.retrievability === 0,
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
