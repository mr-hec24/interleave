/**
 * Wire format for the session context.
 *
 * The §7 controller is pure TypeScript and runs in the browser during a session —
 * it has to, because the ranking is re-evaluated after every attempt and a network
 * round trip per attempt would make the switch decision feel laggy and would fail
 * offline. That means the context has to cross the wire, and Dates, Maps, and the
 * similarity adjacency structure do not survive `JSON.stringify` intact.
 *
 * Keeping the (de)serialisation in one file means the client and server cannot drift
 * on the shape — a mismatch here would surface as a subtly wrong ranking rather than
 * an error, which is the worst kind of bug this system can have.
 */

import type { SchedulerConfig } from "../config";
import type { CandidateSkill } from "../controller";
import type { PrereqEdge } from "../readiness";
import type { SimilarEdge } from "../similarity";
import { buildSimilarityGraph } from "../similarity";
import type { RetrievalPrompt } from "../prompts";
import type { SessionContext } from "./context";

export interface WireSkill {
  id: string;
  name: string;
  stability: number | null;
  difficulty: number;
  priorityWeight: number;
  channelLoadings: number[];
  lastReviewedAt: string | null;
  promptPoolSize: number;
}

export interface WirePrompt {
  id: string;
  skillId: string;
  text: string;
  source: RetrievalPrompt["source"];
  lastServedAt: string | null;
  timesServed: number;
}

export interface WireSessionContext {
  config: SchedulerConfig;
  skills: WireSkill[];
  saturation: number[];
  prereqEdges: PrereqEdge[];
  similarEdges: SimilarEdge[];
  prompts: WirePrompt[];
  /** Server time when the context was assembled, so the client can detect drift. */
  now: string;
  embeddingProvider: string;
}

export function toWire(
  ctx: SessionContext,
  now: Date,
  embeddingProvider: string
): WireSessionContext {
  const similarEdges: SimilarEdge[] = [];
  const seen = new Set<string>();
  for (const [a, neighbours] of ctx.similarityGraph) {
    for (const [b, sim] of neighbours) {
      // The graph stores both directions; emit each undirected pair once.
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      similarEdges.push(a < b ? { skillA: a, skillB: b, sim } : { skillA: b, skillB: a, sim });
    }
  }

  return {
    config: ctx.config,
    skills: ctx.skills.map((s) => ({
      id: s.id,
      name: s.name,
      stability: s.stability,
      difficulty: s.difficulty,
      priorityWeight: s.priorityWeight,
      channelLoadings: [...s.channelLoadings],
      lastReviewedAt: s.lastReviewedAt?.toISOString() ?? null,
      promptPoolSize: s.promptPoolSize,
    })),
    saturation: [...ctx.saturation],
    prereqEdges: ctx.prereqEdges,
    similarEdges,
    prompts: [...ctx.promptsBySkill.values()].flat().map((p) => ({
      id: p.id,
      skillId: p.skillId,
      text: p.text,
      source: p.source,
      lastServedAt: p.lastServedAt?.toISOString() ?? null,
      timesServed: p.timesServed,
    })),
    now: now.toISOString(),
    embeddingProvider,
  };
}

export interface ClientContext {
  config: SchedulerConfig;
  skills: CandidateSkill[];
  saturation: number[];
  prereqEdges: PrereqEdge[];
  similarityGraph: ReturnType<typeof buildSimilarityGraph>;
  promptsBySkill: Map<string, RetrievalPrompt[]>;
  embeddingProvider: string;
}

export function fromWire(wire: WireSessionContext): ClientContext {
  const promptsBySkill = new Map<string, RetrievalPrompt[]>();
  for (const p of wire.prompts) {
    const entry: RetrievalPrompt = {
      id: p.id,
      skillId: p.skillId,
      text: p.text,
      source: p.source,
      lastServedAt: p.lastServedAt ? new Date(p.lastServedAt) : null,
      timesServed: p.timesServed,
    };
    const existing = promptsBySkill.get(p.skillId);
    if (existing) existing.push(entry);
    else promptsBySkill.set(p.skillId, [entry]);
  }

  return {
    config: wire.config,
    skills: wire.skills.map((s) => ({
      ...s,
      lastReviewedAt: s.lastReviewedAt ? new Date(s.lastReviewedAt) : null,
    })),
    saturation: wire.saturation,
    prereqEdges: wire.prereqEdges,
    similarityGraph: buildSimilarityGraph(wire.similarEdges),
    promptsBySkill,
    embeddingProvider: wire.embeddingProvider,
  };
}
