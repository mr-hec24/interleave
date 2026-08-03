/**
 * Embedding provider selection.
 *
 * The provider is chosen once and its `id` is written onto every similarity edge and
 * every scheduling event. That is not bookkeeping: if the metric behind "similar"
 * changes, every conclusion drawn from the interference term changes with it, and a
 * dataset that does not record which metric produced it cannot be reanalysed.
 */

import type { EmbeddingProvider } from "./provider";
import { LexicalEmbeddingProvider } from "./lexical";
import { MiniLmEmbeddingProvider, isMiniLmAvailable } from "./minilm";

export * from "./provider";
export { LexicalEmbeddingProvider } from "./lexical";
export { MiniLmEmbeddingProvider } from "./minilm";

export type ProviderName = "minilm" | "lexical";

let cached: EmbeddingProvider | null = null;

/**
 * Resolves the configured provider.
 *
 * `minilm` is the intended default — it is the only one of the two that can see
 * that "Blues scale in A" and "Pentatonic improvisation" are related — but it
 * requires an opt-in package (see minilm.ts for why it is not a declared
 * dependency). When it is unavailable we fall back rather than crash, and say so
 * loudly, because silently degrading to lexical similarity would bias the §11
 * interference experiment toward the null while looking like it ran fine.
 */
export async function createEmbeddingProvider(
  name: ProviderName = (process.env.EMBEDDING_PROVIDER as ProviderName) ?? "minilm"
): Promise<EmbeddingProvider> {
  if (cached) return cached;

  if (name === "lexical") {
    cached = new LexicalEmbeddingProvider();
    return cached;
  }

  if (await isMiniLmAvailable()) {
    cached = new MiniLmEmbeddingProvider();
    return cached;
  }

  console.warn(
    "[embeddings] MiniLM unavailable; falling back to the lexical provider. " +
      "Lexical similarity cannot see synonymy — 'Blues scale in A' and 'Pentatonic " +
      "improvisation' will score ~0 — so the interference term (§7) will be weak and " +
      "any A/B of it is biased toward the null. Install @huggingface/transformers to " +
      "enable the semantic provider."
  );
  cached = new LexicalEmbeddingProvider();
  return cached;
}

/** Test seam. */
export function __resetProviderCache(): void {
  cached = null;
}
