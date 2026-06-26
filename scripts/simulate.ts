/**
 * Interleave Simulator — synthetic learner + policy comparison + optional DB seed.
 *
 * Usage:
 *   npx tsx scripts/simulate.ts              # run analysis, print table
 *   npx tsx scripts/simulate.ts --csv        # also write CSV to scripts/results.csv
 *   npx tsx scripts/simulate.ts --seed       # seed Supabase DB with realistic history
 *
 * The simulator imports the REAL applySm2 + rankSkills — no reimplementation.
 */

import { applySm2, SM2_DEFAULTS, type Sm2State } from "../src/lib/sm2";
import { rankSkills, type SkillSchedulerInput } from "../src/lib/scheduler";
import * as fs from "fs";

// ─── Synthetic Learner (ground-truth memory model the app never sees) ───

interface LatentSkillState {
  trueStability: number; // S_true in days — how long until R_true decays to ~37%
  lastPracticed: number; // day number of last practice
}

interface SkillConfig {
  name: string;
  initialStability: number; // how "easy" the skill is to start (lower = harder)
  learningGain: number; // how much stability grows per successful practice
}

const SKILL_CONFIGS: SkillConfig[] = [
  { name: "Spanish subjunctive", initialStability: 1.5, learningGain: 1.4 },
  { name: "Piano ii-V-I comping", initialStability: 2.0, learningGain: 1.3 },
  { name: "Backprop math", initialStability: 1.0, learningGain: 1.5 },
  { name: "French reading", initialStability: 2.5, learningGain: 1.2 },
  { name: "Drawing perspective", initialStability: 1.8, learningGain: 1.35 },
];

const SIM_DAYS = 90;
const SESSIONS_PER_DAY = 2; // learner can practice 2 skills per day

function trueRetrievability(daysSince: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.exp(-daysSince / stability);
}

function generateQuality(rTrue: number, noise: number = 0.15): number {
  // Map true retrievability to a 0-5 quality with some noise
  const raw = rTrue * 5 + (Math.random() - 0.5) * 2 * noise * 5;
  return Math.max(0, Math.min(5, Math.round(raw)));
}

// ─── Scheduling Policies ───

type Policy = (
  sm2States: Map<string, Sm2State>,
  latentStates: Map<string, LatentSkillState>,
  day: number,
  configs: SkillConfig[]
) => string[];

function retrievabilityPolicy(
  sm2States: Map<string, Sm2State>,
  _latent: Map<string, LatentSkillState>,
  day: number,
  configs: SkillConfig[]
): string[] {
  const inputs: SkillSchedulerInput[] = configs.map((c) => {
    const sm2 = sm2States.get(c.name)!;
    const latent = _latent.get(c.name)!;
    return {
      skillId: c.name,
      skillName: c.name,
      intervalDays: sm2.intervalDays,
      lastReviewedAt:
        latent.lastPracticed < 0
          ? null
          : new Date((day - (day - latent.lastPracticed)) * 86400000),
      defaultSessionMinutes: 25,
    };
  });
  // Adjust lastReviewedAt to reflect actual days-ago correctly
  const nowDate = new Date(day * 86400000);
  for (const input of inputs) {
    const latent = _latent.get(input.skillId)!;
    if (latent.lastPracticed >= 0) {
      const msAgo = (day - latent.lastPracticed) * 86400000;
      input.lastReviewedAt = new Date(nowDate.getTime() - msAgo);
    }
  }
  const ranked = rankSkills(inputs, nowDate);
  return ranked.slice(0, SESSIONS_PER_DAY).map((r) => r.skillId);
}

function blockedPolicy(
  _sm2: Map<string, Sm2State>,
  _latent: Map<string, LatentSkillState>,
  day: number,
  configs: SkillConfig[]
): string[] {
  // Practice one skill at a time until 10 consecutive days, then move to next
  const blockSize = 10;
  const idx = Math.floor(day / blockSize) % configs.length;
  return Array(SESSIONS_PER_DAY).fill(configs[idx].name);
}

function randomPolicy(
  _sm2: Map<string, Sm2State>,
  _latent: Map<string, LatentSkillState>,
  _day: number,
  configs: SkillConfig[]
): string[] {
  const picks: string[] = [];
  for (let i = 0; i < SESSIONS_PER_DAY; i++) {
    picks.push(configs[Math.floor(Math.random() * configs.length)].name);
  }
  return picks;
}

function roundRobinPolicy(
  _sm2: Map<string, Sm2State>,
  _latent: Map<string, LatentSkillState>,
  day: number,
  configs: SkillConfig[]
): string[] {
  const picks: string[] = [];
  for (let i = 0; i < SESSIONS_PER_DAY; i++) {
    const idx = (day * SESSIONS_PER_DAY + i) % configs.length;
    picks.push(configs[idx].name);
  }
  return picks;
}

const POLICIES: Record<string, Policy> = {
  "Retrievability (interleave)": retrievabilityPolicy,
  Blocked: blockedPolicy,
  Random: randomPolicy,
  "Round-robin": roundRobinPolicy,
};

// ─── Simulation Engine ───

interface SimResult {
  policy: string;
  meanRetention: number; // mean R_true across all skills at end
  minRetention: number; // worst skill R_true at end
  skillsAbove80: number; // how many skills have R_true > 0.80 at end
  wastedReviews: number; // sessions where R_true > 0.95 (no desirable difficulty)
  lapses: number; // sessions where R_true < 0.30 (too much forgetting)
  totalSessions: number;
  dailyRetention: number[]; // mean R_true per day (for plotting)
}

interface SessionRecord {
  day: number;
  skillName: string;
  quality: number;
  rTrue: number;
  sm2Before: Sm2State;
  sm2After: Sm2State;
}

function runSimulation(
  policyName: string,
  policy: Policy,
  configs: SkillConfig[],
  seed: number = 42
): { result: SimResult; sessions: SessionRecord[] } {
  // Seed-ish determinism (good enough for this)
  let rng = seed;
  const origRandom = Math.random;
  Math.random = () => {
    rng = (rng * 1664525 + 1013904223) & 0x7fffffff;
    return rng / 0x7fffffff;
  };

  const sm2States = new Map<string, Sm2State>();
  const latentStates = new Map<string, LatentSkillState>();

  for (const c of configs) {
    sm2States.set(c.name, { ...SM2_DEFAULTS });
    latentStates.set(c.name, {
      trueStability: c.initialStability,
      lastPracticed: -1,
    });
  }

  let wastedReviews = 0;
  let lapses = 0;
  let totalSessions = 0;
  const dailyRetention: number[] = [];
  const allSessions: SessionRecord[] = [];

  for (let day = 0; day < SIM_DAYS; day++) {
    const picks = policy(sm2States, latentStates, day, configs);

    for (const skillName of picks) {
      const latent = latentStates.get(skillName)!;
      const sm2 = sm2States.get(skillName)!;

      const daysSince =
        latent.lastPracticed < 0 ? 999 : day - latent.lastPracticed;
      const rTrue = trueRetrievability(daysSince, latent.trueStability);

      if (rTrue > 0.95) wastedReviews++;
      if (rTrue < 0.3) lapses++;

      const quality = generateQuality(rTrue);
      const sm2Before = { ...sm2 };
      const sm2After = applySm2(sm2, quality);
      sm2States.set(skillName, sm2After);

      // Update latent state: practicing grows true stability
      if (quality >= 3) {
        const config = configs.find((c) => c.name === skillName)!;
        latent.trueStability *= config.learningGain;
        // Cap stability growth
        latent.trueStability = Math.min(latent.trueStability, 120);
      }
      latent.lastPracticed = day;
      totalSessions++;

      allSessions.push({
        day,
        skillName,
        quality,
        rTrue,
        sm2Before,
        sm2After,
      });
    }

    // Record mean true retention across all skills at end of day
    let sumR = 0;
    for (const c of configs) {
      const latent = latentStates.get(c.name)!;
      const daysSince =
        latent.lastPracticed < 0 ? 999 : day - latent.lastPracticed;
      sumR += trueRetrievability(daysSince, latent.trueStability);
    }
    dailyRetention.push(sumR / configs.length);
  }

  // Final retention per skill
  const finalRetentions: number[] = [];
  for (const c of configs) {
    const latent = latentStates.get(c.name)!;
    const daysSince =
      latent.lastPracticed < 0 ? 999 : SIM_DAYS - 1 - latent.lastPracticed;
    finalRetentions.push(trueRetrievability(daysSince, latent.trueStability));
  }

  Math.random = origRandom;

  return {
    result: {
      policy: policyName,
      meanRetention:
        finalRetentions.reduce((a, b) => a + b, 0) / finalRetentions.length,
      minRetention: Math.min(...finalRetentions),
      skillsAbove80: finalRetentions.filter((r) => r > 0.8).length,
      wastedReviews,
      lapses,
      totalSessions,
      dailyRetention,
    },
    sessions: allSessions,
  };
}

// ─── Output ───

function printTable(results: SimResult[]) {
  console.log("\n" + "═".repeat(90));
  console.log(
    "  INTERLEAVE SIMULATOR — 90-day comparison, %d skills, %d sessions/day",
    SKILL_CONFIGS.length,
    SESSIONS_PER_DAY
  );
  console.log("═".repeat(90));

  const header = [
    "Policy".padEnd(28),
    "Mean R".padStart(8),
    "Min R".padStart(8),
    ">80%".padStart(6),
    "Wasted".padStart(8),
    "Lapses".padStart(8),
    "Total".padStart(7),
  ].join(" │ ");

  console.log(header);
  console.log("─".repeat(90));

  for (const r of results) {
    const row = [
      r.policy.padEnd(28),
      (Math.round(r.meanRetention * 1000) / 10).toFixed(1).padStart(7) + "%",
      (Math.round(r.minRetention * 1000) / 10).toFixed(1).padStart(7) + "%",
      `${r.skillsAbove80}/${SKILL_CONFIGS.length}`.padStart(6),
      String(r.wastedReviews).padStart(8),
      String(r.lapses).padStart(8),
      String(r.totalSessions).padStart(7),
    ].join(" │ ");
    console.log(row);
  }

  console.log("═".repeat(90));
  console.log("\nMetric definitions:");
  console.log(
    "  Mean R   — average true retrievability across all skills on day 90"
  );
  console.log(
    "  Min R    — worst-performing skill's true retrievability on day 90"
  );
  console.log("  >80%     — skills with true retrievability above 80% on day 90");
  console.log(
    "  Wasted   — sessions where R_true > 95% (too easy, no desirable difficulty)"
  );
  console.log(
    "  Lapses   — sessions where R_true < 30% (too much forgetting, relearning)"
  );
  console.log();
}

function writeCsv(results: SimResult[]) {
  const lines: string[] = ["day," + results.map((r) => r.policy).join(",")];
  for (let d = 0; d < SIM_DAYS; d++) {
    lines.push(
      d + "," + results.map((r) => r.dailyRetention[d].toFixed(4)).join(",")
    );
  }
  const path = "scripts/results.csv";
  fs.writeFileSync(path, lines.join("\n") + "\n");
  console.log(`Daily retention CSV written to ${path}`);
}

// ─── Supabase Seed ───

async function seedDatabase(sessions: SessionRecord[]) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error(
      "Error: Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local to seed."
    );
    console.error(
      "The service role key bypasses RLS for seeding. Find it in Supabase → Settings → API."
    );
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, serviceKey);

  // Find or prompt for user
  const {
    data: { users },
  } = await supabase.auth.admin.listUsers();
  if (!users || users.length === 0) {
    console.error("No users found. Sign up in the app first, then run --seed.");
    process.exit(1);
  }
  const user = users[0];
  console.log(`Seeding data for user: ${user.email} (${user.id})`);

  // Clear existing data for this user (sessions first due to FK)
  await supabase.from("sessions").delete().eq("user_id", user.id);
  await supabase.from("sr_state").delete().in(
    "skill_id",
    (
      (await supabase.from("skills").select("id").eq("user_id", user.id))
        .data ?? []
    ).map((s: { id: string }) => s.id)
  );
  await supabase.from("skills").delete().eq("user_id", user.id);
  console.log("Cleared existing data.");

  // Create skills
  const skillIds = new Map<string, string>();
  for (const config of SKILL_CONFIGS) {
    const { data, error } = await supabase
      .from("skills")
      .insert({
        user_id: user.id,
        name: config.name,
        description: `Sim skill (initial stability: ${config.initialStability}d)`,
        default_session_minutes: 25,
      })
      .select("id")
      .single();
    if (error) {
      console.error(`Failed to create skill ${config.name}:`, error.message);
      process.exit(1);
    }
    skillIds.set(config.name, data.id);
  }
  console.log(`Created ${skillIds.size} skills.`);

  // Insert sessions with back-dated timestamps
  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() - SIM_DAYS);

  let inserted = 0;
  for (const s of sessions) {
    const sessionDate = new Date(
      baseDate.getTime() + s.day * 86400000 + Math.random() * 43200000
    );
    const dueAt = new Date(
      sessionDate.getTime() + s.sm2After.intervalDays * 86400000
    );

    const { error } = await supabase.from("sessions").insert({
      user_id: user.id,
      skill_id: skillIds.get(s.skillName)!,
      started_at: sessionDate.toISOString(),
      duration_minutes: 25,
      quality: s.quality,
      note: `Day ${s.day}: R_true=${(s.rTrue * 100).toFixed(0)}%`,
      sm2_repetitions_before: s.sm2Before.repetitions,
      sm2_ease_before: s.sm2Before.easeFactor,
      sm2_interval_before: s.sm2Before.intervalDays,
      sm2_repetitions_after: s.sm2After.repetitions,
      sm2_ease_after: s.sm2After.easeFactor,
      sm2_interval_after: s.sm2After.intervalDays,
      due_at_after: dueAt.toISOString(),
    });

    if (error) {
      console.error(`Failed to insert session day ${s.day}:`, error.message);
    } else {
      inserted++;
    }
  }
  console.log(`Inserted ${inserted} sessions.`);

  // Update sr_state to reflect final state from the last session per skill
  for (const config of SKILL_CONFIGS) {
    const skillSessions = sessions.filter((s) => s.skillName === config.name);
    if (skillSessions.length === 0) continue;
    const last = skillSessions[skillSessions.length - 1];
    const lastDate = new Date(
      baseDate.getTime() + last.day * 86400000 + 21600000
    );
    const dueAt = new Date(
      lastDate.getTime() + last.sm2After.intervalDays * 86400000
    );

    await supabase
      .from("sr_state")
      .update({
        repetitions: last.sm2After.repetitions,
        ease_factor: last.sm2After.easeFactor,
        interval_days: last.sm2After.intervalDays,
        last_reviewed_at: lastDate.toISOString(),
        due_at: dueAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("skill_id", skillIds.get(config.name)!);
  }
  console.log(
    "Updated sr_state to reflect final simulation state. Dashboard should now show populated data."
  );
}

// ─── Main ───

async function main() {
  const args = process.argv.slice(2);
  const wantCsv = args.includes("--csv");
  const wantSeed = args.includes("--seed");

  const results: SimResult[] = [];
  let retrievabilitySessions: SessionRecord[] = [];

  for (const [name, policy] of Object.entries(POLICIES)) {
    const { result, sessions } = runSimulation(name, policy, SKILL_CONFIGS);
    results.push(result);
    if (name === "Retrievability (interleave)") {
      retrievabilitySessions = sessions;
    }
  }

  printTable(results);

  if (wantCsv) {
    writeCsv(results);
  }

  if (wantSeed) {
    console.log(
      "\nSeeding Supabase with retrievability policy session history..."
    );
    await seedDatabase(retrievabilitySessions);
  }
}

main().catch(console.error);
