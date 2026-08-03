/**
 * Calibration report over the §10 event log.
 *
 *   npx tsx scripts/calibration.ts              # every user
 *   npx tsx scripts/calibration.ts --user <id>  # one user
 *   npx tsx scripts/calibration.ts --csv        # also write scripts/calibration.csv
 *
 * Answers the question that makes the scheduler's predictions worth anything: when
 * it said 70%, did roughly 70% come back? And the §3 ¶NOVEL question underneath it —
 * whether a "skill" is one forgetting curve or several wearing one label.
 *
 * Reads only. Nothing here writes to the database.
 */

import * as fs from "fs";
import {
  calibrationCurve,
  reliableBins,
  poolHeterogeneity,
  groupBySkill,
  type CalibrationObservation,
} from "../src/lib/v1/calibration";
import type { Grade } from "../src/lib/v1/grade";

interface EventRow {
  user_id: string;
  skill_id: string | null;
  prompt_ref: string | null;
  r_pred: number | string | null;
  grade: string | null;
  ts: string;
  scheduler_version: string;
}

function bar(value: number, width = 24): string {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * width);
  return "█".repeat(filled) + "·".repeat(width - filled);
}

async function main() {
  const args = process.argv.slice(2);
  const userFilter = args.includes("--user") ? args[args.indexOf("--user") + 1] : null;
  const wantCsv = args.includes("--csv");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.\n" +
        "The service role key bypasses RLS so the report can read the whole log."
    );
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, serviceKey);

  let query = db
    .from("events")
    .select("user_id, skill_id, prompt_ref, r_pred, grade, ts, scheduler_version")
    .eq("event_type", "review")
    .not("r_pred", "is", null)
    .order("ts", { ascending: true });
  if (userFilter) query = query.eq("user_id", userFilter);

  const { data, error } = await query;
  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const observations: CalibrationObservation[] = (data ?? [])
    .filter((r: EventRow) => r.skill_id && r.grade)
    .map((r: EventRow) => ({
      skillId: r.skill_id!,
      promptRef: r.prompt_ref,
      rPred: typeof r.r_pred === "number" ? r.r_pred : Number.parseFloat(String(r.r_pred)),
      grade: r.grade as Grade,
      ts: new Date(r.ts),
      schedulerVersion: r.scheduler_version,
    }));

  if (observations.length === 0) {
    console.log("No graded retrievals with a prediction logged yet.");
    return;
  }

  const skillNames = new Map<string, string>();
  const { data: skills } = await db.from("skills").select("id, name");
  for (const s of skills ?? []) skillNames.set(s.id, s.name);

  const overall = calibrationCurve(observations);
  const preMeasurement = observations.length - overall.count;

  console.log("\n" + "═".repeat(78));
  console.log("  CALIBRATION — predicted recall vs. what actually came back");
  console.log("═".repeat(78));
  console.log(
    `  ${overall.count} graded retrievals` +
      (preMeasurement > 0
        ? `  (${preMeasurement} pre-measurement rows excluded)`
        : "")
  );
  console.log();

  if (overall.count < 30) {
    console.log(
      "  Fewer than 30 observations — the numbers below are shown for completeness\n" +
        "  but are too sparse to draw conclusions from.\n"
    );
  }

  console.log("  predicted   observed   n     ");
  console.log("  " + "─".repeat(60));
  for (const b of overall.bins) {
    const flag = b.count < 5 ? " (sparse)" : "";
    console.log(
      `  ${(b.meanPredicted * 100).toFixed(0).padStart(6)}%   ` +
        `${(b.observedRate * 100).toFixed(0).padStart(6)}%   ` +
        `${String(b.count).padStart(4)}  ${bar(b.observedRate)}${flag}`
    );
  }

  console.log();
  console.log(`  ECE  ${overall.ece.toFixed(3)}   (0 = perfect; this is the average miss)`);
  console.log(
    `  Bias ${overall.bias >= 0 ? "+" : ""}${overall.bias.toFixed(3)}   ` +
      (Math.abs(overall.bias) < 0.02
        ? "(no systematic direction)"
        : overall.bias > 0
          ? "(pessimistic — recall beats the prediction)"
          : "(overconfident — recall falls short of the prediction)")
  );
  console.log(
    `  ${reliableBins(overall).length}/${overall.bins.length} bins have enough data to trust.`
  );

  // ── The §3 ¶NOVEL question ────────────────────────────────────────────────
  console.log("\n" + "═".repeat(78));
  console.log("  POOL HETEROGENEITY — is a 'skill' one forgetting curve, or several?");
  console.log("═".repeat(78));
  console.log(
    "  Every validated decay model targets discrete items. Pooling items under a\n" +
      "  skill node is only honest if the items in a pool behave alike. A wide spread\n" +
      "  means the skill's single stability estimate is an average describing none of\n" +
      "  its cues — the signal to split it.\n"
  );

  const bySkill = groupBySkill(observations);
  let flagged = 0;
  for (const [skillId, rows] of bySkill) {
    const h = poolHeterogeneity(skillId, rows);
    if (h.perPrompt.length < 2) continue;
    const name = skillNames.get(skillId) ?? skillId;
    const marker = h.misScoped ? "  ⚠ " : "    ";
    console.log(`${marker}${name}  — spread ${(h.spread * 100).toFixed(0)} points`);
    for (const p of h.perPrompt) {
      console.log(
        `        ${(p.observedRate * 100).toFixed(0).padStart(3)}%  n=${String(p.count).padStart(3)}  ${bar(p.observedRate, 16)}`
      );
    }
    if (h.misScoped) {
      flagged++;
      console.log(
        `        → cues in this pool behave too differently to share one curve;\n` +
          `          consider splitting this skill.`
      );
    }
    console.log();
  }

  if (bySkill.size === 0 || flagged === 0) {
    console.log("  No skill has a cue pool with enough data to flag yet.\n");
  }

  if (wantCsv) {
    const lines = ["bin_lower,bin_upper,mean_predicted,observed_rate,count"];
    for (const b of overall.bins) {
      lines.push(
        [b.lower, b.upper, b.meanPredicted, b.observedRate, b.count]
          .map((x) => (typeof x === "number" ? x.toFixed(4) : x))
          .join(",")
      );
    }
    fs.writeFileSync("scripts/calibration.csv", lines.join("\n") + "\n");
    console.log("Wrote scripts/calibration.csv");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
