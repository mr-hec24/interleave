import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { suggestCues } from "@/lib/v1/import/extract";

/**
 * Cue suggestions for a single hand-created skill.
 *
 * Suggestions only — nothing is written here. The manual skill-creation path uses
 * this so a typed-in skill arrives with cues the same way an imported one does; the
 * learner then edits them before anything is saved.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    // Not an error the learner needs to act on: they can write their own cues.
    return NextResponse.json({ cues: [], unavailable: true });
  }

  let body: { name?: unknown; description?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "A skill name is required." }, { status: 400 });
  }

  try {
    const cues = await suggestCues(new Anthropic(), {
      name,
      description: typeof body.description === "string" ? body.description : null,
    });
    return NextResponse.json({ cues });
  } catch (error) {
    console.error("[import/cues] suggestion failed:", error);
    // Degrade to the manual path rather than blocking skill creation.
    return NextResponse.json({ cues: [], unavailable: true });
  }
}
