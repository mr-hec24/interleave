/**
 * Local sentence-transformer embedding provider — `all-MiniLM-L6-v2` via ONNX.
 *
 * Fully local, deterministic, and inspectable: the weights are a file you can hash
 * and pin, there is no API key, no network call at inference, and no vendor able to
 * silently re-version the model under a running experiment. That last property is
 * the one that matters most here — a hosted embedding API that changes model
 * versions mid-study shifts the entire similarity matrix and quietly invalidates the
 * §11 interference A/B, with every stored edge still looking authoritative.
 *
 * Embeddings are computed **once per skill, at creation or edit**, and stored. They
 * are never on the scheduling hot path, so the usual latency objection to running a
 * model locally does not apply — a few hundred milliseconds once per skill is
 * invisible.
 *
 * ## Why the package is not a declared dependency
 *
 * `@huggingface/transformers` pulls in `onnxruntime-node`, which pulls in `adm-zip`,
 * which carries a high-severity advisory (GHSA-xcpc-8h2w-3j85) with **no fix
 * available**. Installing it takes this project from 6 known vulnerabilities to 9.
 * That is a real cost to impose by default on a codebase that does not otherwise
 * need it, especially since the same package is also what makes the Vercel
 * serverless bundle-size risk real.
 *
 * So the import is dynamic and the package is opt-in:
 *
 *     npm install @huggingface/transformers
 *
 * With it absent, `createEmbeddingProvider` falls back to the lexical provider and
 * says so. With it present, this provider is used. Either way the choice is stamped
 * onto every similarity edge and every event, so the data records which metric
 * produced it.
 *
 * ## Preferred deployment: the browser
 *
 * Running this in the browser at skill-creation time avoids the server bundle
 * entirely — transformers.js uses the WASM backend, caches the model in IndexedDB,
 * and never touches `onnxruntime-node` or its dependency chain. Given embeddings are
 * a once-per-skill operation, that is the natural home for it.
 */

import type { Embedding, EmbeddingProvider } from "./provider";
import { normalise } from "./provider";

/** Pinned. A floating revision would let the model change under stored edges. */
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
const MODEL_REVISION = "main";
const DIMENSIONS = 384;

/* eslint-disable @typescript-eslint/no-explicit-any */
type FeatureExtractionPipeline = (
  texts: string[],
  options: { pooling: string; normalize: boolean }
) => Promise<{ tolist(): number[][] }>;

let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

async function loadPipeline(): Promise<FeatureExtractionPipeline> {
  if (pipelinePromise) return pipelinePromise;
  pipelinePromise = (async () => {
    let mod: any;
    try {
      // Dynamic + non-literal specifier so bundlers do not try to resolve a package
      // that is intentionally absent from package.json.
      const specifier = "@huggingface/transformers";
      mod = await import(/* webpackIgnore: true */ specifier);
    } catch {
      throw new Error(
        "MiniLM embedding provider requires @huggingface/transformers, which is not " +
          "installed. Run `npm install @huggingface/transformers`, or set " +
          "EMBEDDING_PROVIDER=lexical to use the dependency-free lexical provider. " +
          "Note the package adds a high-severity transitive advisory (adm-zip, no fix " +
          "available) — see src/lib/v1/embeddings/minilm.ts."
      );
    }
    return (await mod.pipeline("feature-extraction", MODEL_ID, {
      revision: MODEL_REVISION,
    })) as FeatureExtractionPipeline;
  })();
  return pipelinePromise;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export class MiniLmEmbeddingProvider implements EmbeddingProvider {
  readonly id = `minilm-l6-v2@${MODEL_REVISION}`;
  readonly dimensions = DIMENSIONS;

  async embed(texts: string[]): Promise<Embedding[]> {
    if (texts.length === 0) return [];
    const extract = await loadPipeline();
    // Mean pooling over token embeddings, which is what this model was trained for;
    // CLS pooling on a MiniLM sentence-transformer gives noticeably worse cosine
    // geometry.
    const output = await extract(texts, { pooling: "mean", normalize: true });
    return output.tolist().map((row) => normalise(Float32Array.from(row)));
  }
}

/** True when the optional package is installed and the model can be loaded. */
export async function isMiniLmAvailable(): Promise<boolean> {
  try {
    await loadPipeline();
    return true;
  } catch {
    return false;
  }
}
