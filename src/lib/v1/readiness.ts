/**
 * §6 — Readiness and the reachability mask.
 *
 * Two mechanisms, deliberately separated because they answer different questions:
 *
 *   **Hard mask.** Is this skill *allowed* to be scheduled at all? A skill with an
 *   unmet hard prerequisite is excluded from the argmax entirely.
 *
 *   **Soft readiness.** Given that it is allowed, how *prepared* is the learner —
 *   a graded quantity that participates in the utility sum.
 *
 * Conflating them is the mistake §6 exists to prevent: a purely additive readiness
 * term locks nothing, because a sufficiently urgent skill will always out-score its
 * own unreadiness.
 *
 * ## The gating subtlety
 *
 * §6 says gating "must be multiplicative", and the natural reading is
 * `U_i = 1[reachable(i)] · (...)`. That is a trap. `U_i` can be negative — β·F_i
 * can exceed the positive terms during a heavy session — and multiplying a negative
 * utility by a zero mask yields **0**, which is *greater* than the negative utility
 * of a perfectly legitimate reachable skill. The gate would then promote locked
 * skills to the top of the ranking precisely when the learner is most fatigued.
 *
 * So masked skills are removed from the candidate set before the argmax rather than
 * multiplied by zero within it. That is what "excluded from the argmax entirely"
 * requires, and it is equivalent to multiplicative gating only when utilities are
 * guaranteed non-negative — which here they are not.
 *
 * The same reasoning applies to the measurement-layer invariant in prompts.ts: a
 * skill with no retrieval cue is likewise excluded, not penalised.
 */

import { masteryFromStability } from "./memory";

/** An edge (prereqSkillId → skillId): "skillId requires prereqSkillId". */
export interface PrereqEdge {
  skillId: string;
  prereqSkillId: string;
}

/**
 * Mastery above which a prerequisite counts as met for the hard gate.
 *
 * Deliberately well below 1: the gate asks "has the learner got enough of a
 * foothold to attempt the dependent skill", not "have they perfected this". Set too
 * high, prerequisite chains never open and the graph becomes a wall.
 */
export const PREREQ_MET_THRESHOLD = 0.35;

/** Stability by skill id; null means never reviewed. */
export type StabilityMap = ReadonlyMap<string, number | null>;

function directPrereqs(skillId: string, edges: readonly PrereqEdge[]): string[] {
  return edges.filter((e) => e.skillId === skillId).map((e) => e.prereqSkillId);
}

/**
 * The hard mask: is every direct prerequisite of `skillId` sufficiently mastered?
 *
 * Only *direct* prerequisites are checked, and that is sufficient rather than lazy:
 * if a grandparent were unmet, the parent could not itself have reached the
 * threshold, so the condition propagates transitively through the DAG on its own.
 * Checking direct parents also keeps this O(edges) instead of a graph walk on every
 * ranking.
 */
export function reachable(
  skillId: string,
  edges: readonly PrereqEdge[],
  stabilities: StabilityMap
): boolean {
  for (const prereqId of directPrereqs(skillId, edges)) {
    // An unknown prerequisite is treated as unmet. Failing open here would let a
    // dangling edge silently disable the gate.
    const mastery = masteryFromStability(stabilities.get(prereqId) ?? null);
    if (mastery < PREREQ_MET_THRESHOLD) return false;
  }
  return true;
}

/**
 * Soft readiness on [0,1] — the minimum mastery across direct prerequisites.
 *
 * §6 offers `min` or a product of sigmoids. `min` is chosen: it makes readiness
 * bounded by the *weakest* foundation, which is the honest reading of "prepared for
 * this". A product would let many strong prerequisites paper over one missing
 * foundation, and a mean would do so even more readily.
 *
 * A skill with no prerequisites is fully ready — nothing is holding it back.
 */
export function softReadiness(
  skillId: string,
  edges: readonly PrereqEdge[],
  stabilities: StabilityMap
): number {
  const prereqs = directPrereqs(skillId, edges);
  if (prereqs.length === 0) return 1;
  let min = 1;
  for (const prereqId of prereqs) {
    const mastery = masteryFromStability(stabilities.get(prereqId) ?? null);
    if (mastery < min) min = mastery;
  }
  return min;
}

/** Prerequisites that are not yet met — for explaining a locked skill to the user. */
export function unmetPrereqs(
  skillId: string,
  edges: readonly PrereqEdge[],
  stabilities: StabilityMap
): string[] {
  return directPrereqs(skillId, edges).filter(
    (p) => masteryFromStability(stabilities.get(p) ?? null) < PREREQ_MET_THRESHOLD
  );
}

export interface CycleCheckResult {
  acyclic: boolean;
  /** The cycle found, as a skill-id path, when one exists. */
  cycle: string[] | null;
}

/**
 * Verifies E_prereq is a DAG, mirroring the database trigger in 004.
 *
 * Duplicated in app code on purpose: the import path (§8) proposes edges in bulk
 * from LLM extraction, and discovering a cycle by catching a constraint violation
 * mid-insert leaves a partial graph behind. Checking first lets the whole proposal
 * be rejected or repaired before anything is written.
 *
 * Iterative rather than recursive — an LLM can propose a long chain, and blowing
 * the stack while validating untrusted input is not a failure mode worth having.
 */
export function findCycle(edges: readonly PrereqEdge[]): CycleCheckResult {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    // Traverse prereq → dependent, the direction the DAG must not close.
    const list = adjacency.get(e.prereqSkillId);
    if (list) list.push(e.skillId);
    else adjacency.set(e.prereqSkillId, [e.skillId]);
  }

  const UNVISITED = 0;
  const IN_PROGRESS = 1;
  const DONE = 2;
  const state = new Map<string, number>();
  const parent = new Map<string, string>();

  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.skillId);
    nodes.add(e.prereqSkillId);
  }

  for (const start of nodes) {
    if ((state.get(start) ?? UNVISITED) !== UNVISITED) continue;

    // Explicit stack: [node, index of next neighbour to examine].
    const stack: Array<[string, number]> = [[start, 0]];
    state.set(start, IN_PROGRESS);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const [node, index] = frame;
      const neighbours = adjacency.get(node) ?? [];

      if (index >= neighbours.length) {
        state.set(node, DONE);
        stack.pop();
        continue;
      }
      frame[1] = index + 1;

      const next = neighbours[index];
      const nextState = state.get(next) ?? UNVISITED;

      if (nextState === IN_PROGRESS) {
        // Walk the parent chain back to `next` to report the actual cycle.
        const cycle = [next];
        let cursor = node;
        while (cursor !== next) {
          cycle.push(cursor);
          const p = parent.get(cursor);
          if (p === undefined) break;
          cursor = p;
        }
        cycle.push(next);
        return { acyclic: false, cycle: cycle.reverse() };
      }

      if (nextState === UNVISITED) {
        parent.set(next, node);
        state.set(next, IN_PROGRESS);
        stack.push([next, 0]);
      }
    }
  }

  return { acyclic: true, cycle: null };
}

/** Throwing form, for call sites where a cycle is a programming error. */
export function assertAcyclic(edges: readonly PrereqEdge[]): void {
  const { acyclic, cycle } = findCycle(edges);
  if (!acyclic) {
    throw new Error(`E_prereq contains a cycle: ${cycle!.join(" → ")}`);
  }
}

/**
 * Would adding this edge close a cycle? Cheaper than re-validating the whole graph,
 * and the form the confirm-an-edge UI actually needs.
 */
export function wouldCreateCycle(
  edges: readonly PrereqEdge[],
  candidate: PrereqEdge
): boolean {
  if (candidate.skillId === candidate.prereqSkillId) return true;
  return !findCycle([...edges, candidate]).acyclic;
}
