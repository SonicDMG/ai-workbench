/**
 * Built-in chunking and embedding service presets.
 *
 * Seeded into every workspace created against the memory control
 * plane (and on demand via {@link seedDefaultServices} for any
 * workspace that wants the canonical set). These mirror the
 * `wb_config_*_service_by_workspace` schema in issue #98 and
 * intentionally use small, well-known model + chunking choices so a
 * fresh runtime can ingest something without first POST-ing a service
 * config.
 *
 * Operators are free to delete or replace any of them via the regular
 * service-CRUD routes — these are seeds, not enforced defaults.
 *
 * Design notes:
 *
 *  - Embedding seeds use `engine = "langchain_ts"` to match the
 *    issue-#98 schema. The actual provider call is dispatched through
 *    {@link ../embeddings/langchain.ts} (OpenAI today; Cohere on the
 *    way), and the same record is recognised by the Astra driver as
 *    `$vectorize`-eligible.
 *  - Chunking seeds use `engine = "langchain_ts"` for parity even
 *    though the in-process `recursive-char` and `line` chunkers are
 *    hand-rolled today — the engine field describes the *family*, not
 *    the literal package.
 *  - Docling is intentionally absent from v1 seeds. The schema field
 *    `engine = "docling"` stays valid; we just don't ship a default.
 */

import type {
	CreateChunkingServiceInput,
	CreateEmbeddingServiceInput,
	CreateLlmServiceInput,
} from "./store.js";

export interface DefaultServices {
	readonly chunking: readonly CreateChunkingServiceInput[];
	readonly embedding: readonly CreateEmbeddingServiceInput[];
}

/** Recursive-character chunker — small, tighter chunks for precise retrieval. */
const RECURSIVE_CHAR_SMALL: CreateChunkingServiceInput = {
	name: "recursive-char-500",
	description:
		"Small recursive character splitter (500 chars / 75 overlap) honoring paragraph, sentence, and word boundaries. Good for short notes and precise retrieval.",
	status: "active",
	engine: "langchain_ts",
	strategy: "recursive",
	chunkUnit: "characters",
	maxChunkSize: 500,
	minChunkSize: 50,
	overlapSize: 75,
	overlapUnit: "characters",
	preserveStructure: true,
};

/** Recursive-character chunker — the runtime default. */
const RECURSIVE_CHAR_DEFAULT: CreateChunkingServiceInput = {
	name: "recursive-char-1000",
	description:
		"Default. Recursive character splitter (1000 chars / 150 overlap) honoring paragraph, sentence, and word boundaries. Good for prose, markdown, mixed content.",
	status: "active",
	engine: "langchain_ts",
	strategy: "recursive",
	chunkUnit: "characters",
	maxChunkSize: 1000,
	minChunkSize: 100,
	overlapSize: 150,
	overlapUnit: "characters",
	preserveStructure: true,
};

/** Recursive-character chunker — larger chunks for long-form prose. */
const RECURSIVE_CHAR_LARGE: CreateChunkingServiceInput = {
	name: "recursive-char-2000",
	description:
		"Large recursive character splitter (2000 chars / 250 overlap) honoring paragraph, sentence, and word boundaries. Good for long-form documentation and reports.",
	status: "active",
	engine: "langchain_ts",
	strategy: "recursive",
	chunkUnit: "characters",
	maxChunkSize: 2000,
	minChunkSize: 150,
	overlapSize: 250,
	overlapUnit: "characters",
	preserveStructure: true,
};

/** Recursive-character chunker — broad context windows for high-context retrieval. */
const RECURSIVE_CHAR_XL: CreateChunkingServiceInput = {
	name: "recursive-char-4000",
	description:
		"Extra-large recursive character splitter (4000 chars / 400 overlap) honoring paragraph, sentence, and word boundaries. Good when retrieval needs broad context.",
	status: "active",
	engine: "langchain_ts",
	strategy: "recursive",
	chunkUnit: "characters",
	maxChunkSize: 4000,
	minChunkSize: 250,
	overlapSize: 400,
	overlapUnit: "characters",
	preserveStructure: true,
};

/**
 * Line-based chunker — one row per chunk. The default newline-delimited
 * preset. Honors `\n`, `\r\n`, and lone `\r` boundaries so CSV, JSONL,
 * and log files split row-by-row regardless of the source platform.
 * Supersedes the older `line-1000` / `line-2000` / `line-5000` presets,
 * which packed multiple rows per chunk and confused users who expected
 * the line splitter to actually split per line.
 */
const LINE_ROWS_ONE: CreateChunkingServiceInput = {
	name: "line-rows-1",
	description:
		"Line-based splitter — one row per chunk. Snaps to `\\n`, `\\r\\n`, or `\\r` boundaries. Default for CSV, JSONL, and log files where every row should be its own retrievable record.",
	status: "active",
	engine: "langchain_ts",
	strategy: "line",
	chunkUnit: "rows",
	maxChunkSize: 1,
	minChunkSize: 0,
	overlapSize: 0,
	overlapUnit: "rows",
	preserveStructure: true,
};

/** OpenAI text-embedding-3-small — the runtime default. */
const OPENAI_SMALL: CreateEmbeddingServiceInput = {
	name: "openai-text-embedding-3-small",
	description:
		"Default. OpenAI `text-embedding-3-small` (1536-dim, cosine). Astra `$vectorize`-eligible — server-side embedding when the workspace uses the Astra driver.",
	status: "active",
	provider: "openai",
	modelName: "text-embedding-3-small",
	embeddingDimension: 1536,
	distanceMetric: "cosine",
	authType: "api_key",
	credentialRef: "env:OPENAI_API_KEY",
	maxBatchSize: 512,
	maxInputTokens: 8191,
	supportedLanguages: ["en", "multi"],
	supportedContent: ["text"],
};

/** OpenAI text-embedding-3-large — quality preset. */
const OPENAI_LARGE: CreateEmbeddingServiceInput = {
	name: "openai-text-embedding-3-large",
	description:
		"Quality preset. OpenAI `text-embedding-3-large` (3072-dim, cosine). Astra `$vectorize`-eligible.",
	status: "active",
	provider: "openai",
	modelName: "text-embedding-3-large",
	embeddingDimension: 3072,
	distanceMetric: "cosine",
	authType: "api_key",
	credentialRef: "env:OPENAI_API_KEY",
	maxBatchSize: 512,
	maxInputTokens: 8191,
	supportedLanguages: ["en", "multi"],
	supportedContent: ["text"],
};

/** Cohere embed-v4 — multilingual preset. */
const COHERE_MULTILINGUAL: CreateEmbeddingServiceInput = {
	name: "cohere-embed-v4-multilingual",
	description:
		"Multilingual preset. Cohere `embed-v4.0` (1024-dim, cosine). Astra `$vectorize`-eligible.",
	status: "active",
	provider: "cohere",
	modelName: "embed-v4.0",
	embeddingDimension: 1024,
	distanceMetric: "cosine",
	authType: "api_key",
	credentialRef: "env:COHERE_API_KEY",
	maxBatchSize: 96,
	maxInputTokens: 512,
	supportedLanguages: ["multi"],
	supportedContent: ["text"],
};

/**
 * NVIDIA NV-EmbedQA-E5-v5 — Astra's bundled NVIDIA NIM embedding model.
 * 1024-dim, multilingual, retrieval-tuned. Pre-existing collections in
 * Astra often default to this model, so seeding it makes the
 * "Attach existing" KB flow work out of the box without the user
 * having to hand-create a matching embedding service.
 *
 * `credentialRef` is intentionally null: Astra ships an Astra-managed
 * KMS shared-secret for the bundled NIM models, so embedding traffic
 * is server-side and the runtime should NOT attach an
 * `x-embedding-api-key` header. Operators who wire NVIDIA via their
 * own API key can patch this service to set `credentialRef`.
 *
 * `authType` is also `"none"` for the same reason — not because the
 * upstream is unauthenticated, but because there's no client-side
 * credential to manage on this preset.
 */
const NVIDIA_NV_EMBEDQA_E5_V5: CreateEmbeddingServiceInput = {
	name: "nvidia-nv-embedqa-e5-v5",
	description:
		"NVIDIA `nvidia/nv-embedqa-e5-v5` (1024-dim, cosine). Multilingual, retrieval-tuned. Matches the default Astra-bundled NIM embedding model — auth is handled by Astra's KMS, no client-side API key needed. Useful when attaching to a pre-existing Astra collection that uses NVIDIA vectorize.",
	status: "active",
	provider: "nvidia",
	modelName: "nvidia/nv-embedqa-e5-v5",
	embeddingDimension: 1024,
	distanceMetric: "cosine",
	authType: "none",
	credentialRef: null,
	maxBatchSize: 64,
	maxInputTokens: 512,
	supportedLanguages: ["multi"],
	supportedContent: ["text"],
};

export const DEFAULT_SERVICES: DefaultServices = {
	chunking: [
		RECURSIVE_CHAR_DEFAULT,
		RECURSIVE_CHAR_SMALL,
		RECURSIVE_CHAR_LARGE,
		RECURSIVE_CHAR_XL,
		LINE_ROWS_ONE,
	],
	embedding: [
		OPENAI_SMALL,
		OPENAI_LARGE,
		COHERE_MULTILINGUAL,
		NVIDIA_NV_EMBEDQA_E5_V5,
	],
};

/**
 * Curated subset of {@link DEFAULT_SERVICES} that the workspace POST
 * handler auto-seeds into every freshly-created workspace via the
 * public API. Intentionally small — one canonical character chunker,
 * one canonical line chunker, and the NVIDIA `nv-embedqa-e5-v5`
 * (1024-dim) embedder. NVIDIA NIM is bundled with Astra and runs
 * server-side via `$vectorize`, so "Attach existing" works out of
 * the box for Astra collections without forcing operators to mint
 * an OpenAI key just for embedding. Add OpenAI / Cohere embedders
 * explicitly via the service-CRUD routes when you want them; the
 * full {@link DEFAULT_SERVICES} catalog is still available for the
 * memory-control-plane bootstrap path (`buildControlPlane` with
 * `seedWorkspaces`) when the broader preset menu is useful.
 */
export const DEFAULT_WORKSPACE_SEED_SERVICES: DefaultServices = {
	chunking: [RECURSIVE_CHAR_DEFAULT, LINE_ROWS_ONE],
	embedding: [NVIDIA_NV_EMBEDQA_E5_V5],
};

/** HuggingFace `openai/gpt-oss-20b` — the default chat LLM
 * auto-seeded into every new workspace. Matches the runtime's
 * default `chat.model` so a fresh install that pastes a HuggingFace
 * token via `/settings` lights up agent chat immediately, without
 * any LLM-service edits.
 *
 * Chosen for routability, not just "is a chat model". HF's Inference
 * Providers router only serves models that a third-party provider has
 * onboarded, and `provider: "auto"` picks from the providers the
 * caller's account has enabled. `openai/gpt-oss-20b` is the
 * widest-served *ungated* small chat model on the router (live across
 * groq, novita, together, fireworks, and several more as of this
 * release), so a fresh token with default provider settings can
 * almost always route it. Two earlier defaults failed here:
 * `mistralai/Mistral-7B-Instruct-v0.3` ("is not a chat model") and
 * `Qwen/Qwen2.5-7B-Instruct` ("not supported by any provider you have
 * enabled" — it simply isn't onboarded by any router provider).
 *
 * gpt-oss-20b is served for native function calling, and the HF
 * adapter ([`chat/huggingface.ts`](../chat/huggingface.ts)) forwards
 * the agent's `tools[]` and parses the model's `tool_calls`, so the
 * dispatcher's tool loop (list_kbs → search_kb → answer) works the
 * same way it does on the OpenAI adapter. */
const HUGGINGFACE_GPT_OSS_20B: CreateLlmServiceInput = {
	name: "huggingface-gpt-oss-20b",
	description:
		"Default. HuggingFace `openai/gpt-oss-20b` chat completion via the HF Inference Providers router. Used by Bobby + Maven; relies on the runtime's `chat.tokenRef` (default `env:HUGGINGFACE_API_KEY`) or a per-service credentialRef.",
	status: "active",
	provider: "huggingface",
	modelName: "openai/gpt-oss-20b",
	contextWindowTokens: 131072,
	maxOutputTokens: 1024,
	supportsStreaming: true,
	supportsTools: true,
	authType: "api_key",
	credentialRef: "env:HUGGINGFACE_API_KEY",
	supportedLanguages: ["en", "multi"],
	supportedContent: ["text"],
};

/**
 * Curated chat LLM services auto-seeded into every freshly-created
 * workspace via the public API. Currently a single HuggingFace entry —
 * the runtime's default chat surface and the wizard's managed env file
 * both key off `HUGGINGFACE_API_KEY`, so an out-of-the-box install
 * answers messages with zero LLM-service edits once a token is pasted.
 * Operators can add more LLM services (OpenAI, Anthropic, etc.) via
 * the regular service-CRUD routes; the form gates them as "not yet
 * wired" so they're discoverable but not silently broken.
 */
export const DEFAULT_WORKSPACE_SEED_LLM_SERVICES: readonly CreateLlmServiceInput[] =
	Object.freeze([HUGGINGFACE_GPT_OSS_20B]);
