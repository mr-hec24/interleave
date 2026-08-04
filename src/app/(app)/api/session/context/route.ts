import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadSessionContext } from "@/lib/v1/session/context";
import { toWire } from "@/lib/v1/session/wire";

/**
 * Scheduler state for the client-side controller.
 *
 * Fetched once at session start. The controller then re-ranks locally after every
 * attempt — a round trip per attempt would make the switch decision feel laggy, and
 * the ranking is pure arithmetic over state the client already holds.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const now = new Date();
  const ctx = await loadSessionContext(supabase, user.id, now);

  return NextResponse.json(
    toWire(ctx, now, process.env.EMBEDDING_PROVIDER ?? "lexical-hash-v1")
  );
}
