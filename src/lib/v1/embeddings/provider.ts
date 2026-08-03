/**
 * Embedding providers.
 *
 * §2 gives each skill a text embedding e_i, and E_similar is thresholded cosine
 * similarity over those. That edge set carries the entire semantic-spacing thesis:
 * it defines the interference penalty (§7) and, in v3, the transfer pathway (§9.4).
 * Without it, "prevents semantic saturation" is unmeasurable hand-waving.
 *
 * Which means the quality of this one function determines whether §11's interference
 * A/B can answer its question at all. If similarity is measured badly, a null result
 * is uninterpretable: you cannot distinguish "the interference penalty doesn't work"
 * from "my similarity metric couldn't see similarity."
 *
 * ## Why an interface rather than a single implementation
 *
 * The spec's own first principle — "the loop is the constant; the models are
 * replaceable" — applied one level down. Everything downstream consumes `sim` as a
 * number; nothing consumes the embedding. So the provider is swappable, the choice
 * is recorded on every edge and every event, and "does a semantic metric beat a
 * lexical one for Intf_i" becomes a question the logged data can answer rather than
 * an assumption baked into the schema.
 */

/** A unit-normalised embedding. Normalisation is the provider's responsibility. */
export type Embedding = Float32Array;

export interface EmbeddingProvider {
  /**
   * Stable identifier, written to skill_similar_edges.provider and events.
   * Must change whenever the model or its preprocessing changes — a silent
   * re-version would redefine what "similar" means mid-experiment while leaving
   * every stored edge looking authoritative.
   */
  readonly id: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Embedding[]>;
}

/**
 * Cosine similarity. Assumes unit-normalised inputs, so this is a dot product —
 * but it guards the degenerate case rather than returning NaN into the scheduler.
 */
export function cosineSimilarity(a: Embedding, b: Embedding): number {
  if (a.length !== b.length) {
    throw new Error(`embedding dimension mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  const sim = dot / Math.sqrt(normA * normB);
  // Clamp: floating-point error can push an identical pair a hair past 1, which
  // would trip the `sim <= 1` database constraint on an edge that is simply exact.
  return Math.min(1, Math.max(-1, sim));
}

export function normalise(v: Float32Array): Float32Array {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return v;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / norm;
  return out;
}

/**
 * The text a skill is embedded from.
 *
 * §2 says "embedding of the skill's description". We include the retrieval-cue pool
 * as well, a deliberate widening: the cues are concrete statements of what is
 * actually retrieved, which is a far better semantic signature than a title and an
 * optional one-line note. Two skills named "Chapter 3" and "Chapter 4" are
 * indistinguishable by description and obviously distinguishable by their cues.
 *
 * Cue text is truncated so a skill with a long pool cannot swamp its own name in
 * the averaged representation.
 */
export function skillEmbeddingText(skill: {
  name: string;
  description?: string | null;
  promptTexts?: readonly string[];
}): string {
  const parts = [skill.name];
  if (skill.description?.trim()) parts.push(skill.description.trim());
  for (const p of (skill.promptTexts ?? []).slice(0, 8)) {
    const trimmed = p.trim();
    if (trimmed) parts.push(trimmed.slice(0, 240));
  }
  return parts.join(". ");
}
