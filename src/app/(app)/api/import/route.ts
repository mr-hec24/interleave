import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { extractSkillGraph } from "@/lib/v1/import/extract";

/**
 * §8 import pass.
 *
 * Extraction only — this route writes nothing. The proposal comes back for the
 * learner to review, and a second call commits what they accept. That split is not
 * ceremony: §2 calls LLM-extracted prerequisite edges noisy by construction, and an
 * edge applied without review can lock a skill the learner could have practised.
 */

export const maxDuration = 300;

const MAX_MATERIAL_CHARS = 200_000;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "Import is not configured: ANTHROPIC_API_KEY is unset." },
      { status: 503 }
    );
  }

  let body: { material?: unknown; topicName?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Malformed request body." }, { status: 400 });
  }

  const material = typeof body.material === "string" ? body.material.trim() : "";
  if (!material) {
    return NextResponse.json(
      { error: "Nothing to import — paste your notes, syllabus, or outline." },
      { status: 400 }
    );
  }
  if (material.length > MAX_MATERIAL_CHARS) {
    return NextResponse.json(
      {
        error:
          "That material is too long for one pass. Import it a topic at a time — " +
          "smaller passes also produce sharper retrieval cues.",
      },
      { status: 413 }
    );
  }

  const client = new Anthropic();

  try {
    const result = await extractSkillGraph(client, {
      material,
      topicName: typeof body.topicName === "string" ? body.topicName : undefined,
    });

    if (result.skills.length === 0) {
      return NextResponse.json(
        {
          error:
            "No practisable skills could be drawn from that material. It may be too " +
            "general — an outline of specific topics works better than a summary.",
        },
        { status: 422 }
      );
    }

    // Returned, not applied. The commit route logs the `import` event once the
    // learner accepts, so the log records what was kept rather than what was offered.
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Import failed.";
    if (error instanceof Anthropic.RateLimitError) {
      return NextResponse.json(
        { error: "Rate limited. Try again in a moment." },
        { status: 429 }
      );
    }
    if (error instanceof Anthropic.AuthenticationError) {
      return NextResponse.json(
        { error: "Import is not configured: the Anthropic API key was rejected." },
        { status: 503 }
      );
    }
    console.error("[import] extraction failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
