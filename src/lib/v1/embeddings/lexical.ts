/**
 * Lexical (hashed TF-IDF-ish) embedding provider.
 *
 * Dependency-free, deterministic, instant, and offline. Two jobs:
 *
 *   1. **The test and CI provider.** Nothing in the test suite should download a
 *      model file or depend on one being present.
 *   2. **The comparison arm.** §11 wants the interference penalty A/B'd. Being able
 *      to run the same experiment with a purely lexical similarity metric turns
 *      "does semantic similarity matter here" into a measurable question instead of
 *      an assumption.
 *
 * ## What it cannot do, stated plainly
 *
 * This measures *lexical* overlap and calls it similarity. On the actual workload
 * that is a weak proxy:
 *
 *   - "Blues scale in A" vs "Pentatonic improvisation" — genuinely adjacent, shares
 *     no tokens, scores ≈ 0.
 *   - "Passé composé conjugation" vs "Present perfect conjugation" — scores high on
 *     the shared token "conjugation". Right answer, wrong reason.
 *
 * Character n-grams recover some morphological overlap, which is why they are here,
 * but nothing recovers synonymy without a semantic model. Use this provider for
 * tests and ablations; do not ship it as the default and then conclude from a null
 * result that semantic spacing does not exist.
 */

import type { Embedding, EmbeddingProvider } from "./provider";
import { normalise } from "./provider";

const DIMENSIONS = 512;

/**
 * Tokens that carry no discriminative signal in skill descriptions. Kept short and
 * domain-agnostic: with a per-user corpus of 10–50 short strings there is nowhere
 * near enough text for IDF to discover these on its own, which is exactly why a
 * true TF-IDF is not attempted here.
 */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "from",
  "is", "are", "be", "at", "by", "it", "this", "that", "as", "your", "you",
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics: "passé" ~ "passe"
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** FNV-1a. Small, fast, well-distributed enough for bucketing. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function addFeature(vec: Float32Array, feature: string, weight: number): void {
  const h = hash(feature);
  const index = h % DIMENSIONS;
  // Sign from a separate bit of the hash, so unrelated features that collide are
  // as likely to cancel as to reinforce rather than always inflating similarity.
  const sign = (h >>> 31) & 1 ? -1 : 1;
  vec[index] += sign * weight;
}

export class LexicalEmbeddingProvider implements EmbeddingProvider {
  readonly id = "lexical-hash-v1";
  readonly dimensions = DIMENSIONS;

  async embed(texts: string[]): Promise<Embedding[]> {
    return texts.map((text) => {
      const vec = new Float32Array(DIMENSIONS);
      const tokens = tokenise(text);

      for (const token of tokens) {
        // Sublinear term weighting: a cue repeating a word six times is not six
        // times more about it.
        addFeature(vec, `w:${token}`, 1);

        // Character 4-grams give partial credit for shared morphology
        // ("conjugation" ~ "conjugate"), down-weighted so they inform rather than
        // dominate the whole-word signal.
        if (token.length >= 5) {
          for (let i = 0; i + 4 <= token.length; i++) {
            addFeature(vec, `g:${token.slice(i, i + 4)}`, 0.25);
          }
        }
      }

      // Sublinear scaling applied after accumulation.
      for (let i = 0; i < vec.length; i++) {
        vec[i] = Math.sign(vec[i]) * Math.log1p(Math.abs(vec[i]));
      }

      return normalise(vec);
    });
  }
}
