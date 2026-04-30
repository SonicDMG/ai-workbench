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

/** Line-based chunker — tighter chunks for newline-delimited records. */
const LINE_BASED_SMALL: CreateChunkingServiceInput = {
	name: "line-1000",
	description:
		"Small line-based splitter (1000 chars per chunk, snaps to `\\n` boundaries). Good for compact CSV, JSONL, and logs where rows must stay intact.",
	status: "active",
	engine: "langchain_ts",
	strategy: "line",
	chunkUnit: "characters",
	maxChunkSize: 1000,
	minChunkSize: 0,
	overlapSize: 0,
	overlapUnit: "characters",
	preserveStructure: true,
};

/** Line-based chunker — default for newline-delimited content (CSV, JSONL, logs). */
const LINE_BASED_DEFAULT: CreateChunkingServiceInput = {
	name: "line-2000",
	description:
		"Line-based splitter (2000 chars per chunk, snaps to `\\n` boundaries). Default for CSV, JSONL, and other newline-delimited content where rows must stay intact.",
	status: "active",
	engine: "langchain_ts",
	strategy: "line",
	chunkUnit: "characters",
	maxChunkSize: 2000,
	minChunkSize: 0,
	overlapSize: 0,
	overlapUnit: "characters",
	preserveStructure: true,
};

/** Line-based chunker — larger rows/log events. */
const LINE_BASED_LARGE: CreateChunkingServiceInput = {
	name: "line-5000",
	description:
		"Large line-based splitter (5000 chars per chunk, snaps to `\\n` boundaries). Good for wider CSV rows, JSONL payloads, and verbose logs.",
	status: "active",
	engine: "langchain_ts",
	strategy: "line",
	chunkUnit: "characters",
	maxChunkSize: 5000,
	minChunkSize: 0,
	overlapSize: 0,
	overlapUnit: "characters",
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

export const DEFAULT_SERVICES: DefaultServices = {
	chunking: [
		RECURSIVE_CHAR_DEFAULT,
		RECURSIVE_CHAR_SMALL,
		RECURSIVE_CHAR_LARGE,
		RECURSIVE_CHAR_XL,
		LINE_BASED_DEFAULT,
		LINE_BASED_SMALL,
		LINE_BASED_LARGE,
	],
	embedding: [OPENAI_SMALL, OPENAI_LARGE, COHERE_MULTILINGUAL],
};

/**
 * Curated subset of {@link DEFAULT_SERVICES} that the workspace POST
 * handler auto-seeds into every freshly-created workspace via the
 * public API. Intentionally small — one canonical character chunker,
 * one canonical line chunker, and one canonical OpenAI embedder — so a
 * brand-new workspace can ingest something without first POST-ing a
 * service config, but without flooding the UI's service pickers with
 * presets the operator never asked for.
 *
 * Operators can delete or replace any of them via the regular
 * service-CRUD routes; the full {@link DEFAULT_SERVICES} catalog is
 * still available for the memory-control-plane bootstrap path
 * (`buildControlPlane` with `seedWorkspaces`), which needs the broader
 * preset menu for demo / test environments.
 */
export const DEFAULT_WORKSPACE_SEED_SERVICES: DefaultServices = {
	chunking: [RECURSIVE_CHAR_DEFAULT, LINE_BASED_DEFAULT],
	embedding: [OPENAI_SMALL],
};

/** OpenAI `gpt-4o-mini` — the default chat LLM auto-seeded into every
 * new workspace. Supports native function calling, which the agent
 * tool-call loop in {@link ../chat/agent-dispatch.ts} requires. */
const OPENAI_GPT_4O_MINI: CreateLlmServiceInput = {
	name: "openai-gpt-4o-mini",
	description:
		"Default. OpenAI `gpt-4o-mini` chat completion with native function calling. Used by Bobby + Heidi to call the workspace tools (search_kb, list_documents, summarize_kb, etc.).",
	status: "active",
	provider: "openai",
	modelName: "gpt-4o-mini",
	contextWindowTokens: 128000,
	maxOutputTokens: 1024,
	supportsStreaming: true,
	supportsTools: true,
	authType: "api_key",
	credentialRef: "env:OPENAI_API_KEY",
	supportedLanguages: ["en", "multi"],
	supportedContent: ["text"],
};

/**
 * Curated chat LLM services auto-seeded into every freshly-created
 * workspace via the public API. Currently a single OpenAI entry —
 * the agent tool-call loop needs native function calling, which only
 * the OpenAI adapter implements today. Operators can add more LLM
 * services (HuggingFace, Anthropic, etc.) via the regular service-
 * CRUD routes.
 */
export const DEFAULT_WORKSPACE_SEED_LLM_SERVICES: readonly CreateLlmServiceInput[] =
	Object.freeze([OPENAI_GPT_4O_MINI]);
