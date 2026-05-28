/**
 * UI catalog of well-known chunking, embedding, and reranking
 * configurations.
 *
 * This is a *dropdown helper*, not a behavior contract — the runtime's
 * source of truth lives at
 * `runtimes/typescript/src/control-plane/default-services.ts` and
 * actually seeds workspaces. This module mirrors the same names and
 * provider/model/dimension triples so the create-service dialogs can
 * offer one-click presets without the operator having to remember
 * exact strings.
 *
 * Keep these two files in sync. The frontend test
 * `service-catalog.test.ts` pins the names so a drift on either side
 * fails CI.
 */

import type {
	CreateChunkingServiceInput,
	CreateEmbeddingServiceInput,
	CreateRerankingServiceInput,
} from "./schemas";

export interface EmbeddingPreset {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly input: CreateEmbeddingServiceInput;
}

export interface ChunkingPreset {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly input: CreateChunkingServiceInput;
}

export interface RerankingPreset {
	readonly id: string;
	readonly label: string;
	readonly description: string;
	readonly input: CreateRerankingServiceInput;
}

/** Provider names recognised by the runtime's embedding factory.
 *
 * NVIDIA is exposed alongside OpenAI because the runtime auto-seeds an
 * `nvidia/nv-embedqa-e5-v5` service (see
 * `runtimes/typescript/src/control-plane/default-services.ts`) — the
 * picker should let an operator recreate or extend that without
 * dropping into raw API calls. Cohere is intentionally absent here:
 * the runtime still seeds a Cohere preset, but it requires
 * `env:COHERE_API_KEY`, which most local installs don't have, while
 * NVIDIA's bundled NIM auth is handled by Astra's KMS so it works out
 * of the box. */
export const EMBEDDING_PROVIDERS: readonly {
	readonly value: string;
	readonly label: string;
}[] = [
	{ value: "openrouter", label: "OpenRouter" },
	{ value: "ollama", label: "Ollama (local)" },
	{ value: "openai", label: "OpenAI" },
	{ value: "nvidia", label: "NVIDIA" },
];

/** Model catalog per embedding provider — used to scope the model
 * dropdown once a provider is picked. Dim is the *native* dimension;
 * OpenAI's 3-* family supports truncation via the `dimensions` knob,
 * while local models (Ollama nomic-embed-text → 768) are fixed. */
export const EMBEDDING_MODELS: Readonly<
	Record<
		string,
		readonly { readonly value: string; readonly dimension: number }[]
	>
> = {
	openrouter: [
		{ value: "openai/text-embedding-3-small", dimension: 1536 },
		{ value: "openai/text-embedding-3-large", dimension: 3072 },
	],
	ollama: [
		// Local Ollama server. Fixed native dimension — must match the
		// KB's vector collection. No API key needed.
		{ value: "nomic-embed-text", dimension: 768 },
	],
	openai: [
		{ value: "text-embedding-3-small", dimension: 1536 },
		{ value: "text-embedding-3-large", dimension: 3072 },
		{ value: "text-embedding-ada-002", dimension: 1536 },
	],
	nvidia: [
		// Astra-bundled NIM. 1024-dim, multilingual, retrieval-tuned.
		// Auth is handled by Astra's KMS so no client-side API key is
		// needed when the workspace runs against an Astra collection.
		{ value: "nvidia/nv-embedqa-e5-v5", dimension: 1024 },
	],
};

/** Engine names recognised by the chunking-service schema (issue #98). */
export const CHUNKING_ENGINES: readonly {
	readonly value: string;
	readonly label: string;
}[] = [
	{ value: "langchain_ts", label: "LangChain JS" },
	{ value: "docling", label: "Docling" },
];

/** Strategy options per engine. */
export const CHUNKING_STRATEGIES: Readonly<
	Record<string, readonly { readonly value: string; readonly label: string }[]>
> = {
	langchain_ts: [
		{ value: "recursive", label: "Recursive character" },
		{ value: "line", label: "Line-based" },
	],
	docling: [{ value: "layout", label: "Layout-aware" }],
};

/** Provider catalog for rerankers. */
export const RERANKING_PROVIDERS: readonly {
	readonly value: string;
	readonly label: string;
}[] = [{ value: "cohere", label: "Cohere" }];

export const RERANKING_MODELS: Readonly<
	Record<string, readonly { readonly value: string }[]>
> = {
	cohere: [
		{ value: "rerank-english-v3.0" },
		{ value: "rerank-multilingual-v3.0" },
	],
};

/** Embedding presets — mirror the runtime's `DEFAULT_SERVICES.embedding`. */
export const EMBEDDING_PRESETS: readonly EmbeddingPreset[] = [
	{
		id: "openrouter-text-embedding-3-small",
		label: "OpenRouter text-embedding-3-small",
		description:
			"Default. 1536 dimensions, cosine. Uses the same OPENROUTER_API_KEY as chat — one key for both.",
		input: {
			name: "openrouter-text-embedding-3-small",
			description:
				"OpenRouter openai/text-embedding-3-small (1536-dim, cosine).",
			provider: "openrouter",
			modelName: "openai/text-embedding-3-small",
			embeddingDimension: 1536,
			distanceMetric: "cosine",
			authType: "api_key",
			credentialRef: "env:OPENROUTER_API_KEY",
		},
	},
	{
		id: "ollama-nomic-embed-text",
		label: "Ollama nomic-embed-text (local)",
		description:
			"Local/offline. 768 dimensions, cosine. Runs against a local Ollama server — no API key, works air-gapped once the model is pulled.",
		input: {
			name: "ollama-nomic-embed-text",
			description: "Ollama nomic-embed-text (768-dim, cosine), local/offline.",
			provider: "ollama",
			modelName: "nomic-embed-text",
			embeddingDimension: 768,
			distanceMetric: "cosine",
			authType: "none",
			credentialRef: null,
		},
	},
	{
		id: "openai-text-embedding-3-small",
		label: "OpenAI text-embedding-3-small",
		description:
			"Direct OpenAI (BYO key). 1536 dimensions, cosine. Astra `$vectorize`-eligible — server-side embedding when the workspace uses the Astra driver.",
		input: {
			name: "openai-text-embedding-3-small",
			description: "OpenAI text-embedding-3-small (1536-dim, cosine).",
			provider: "openai",
			modelName: "text-embedding-3-small",
			embeddingDimension: 1536,
			distanceMetric: "cosine",
			authType: "api_key",
			credentialRef: "env:OPENAI_API_KEY",
		},
	},
	{
		id: "openai-text-embedding-3-large",
		label: "OpenAI text-embedding-3-large",
		description:
			"Quality preset. 3072 dimensions, cosine. Astra `$vectorize`-eligible.",
		input: {
			name: "openai-text-embedding-3-large",
			description: "OpenAI text-embedding-3-large (3072-dim, cosine).",
			provider: "openai",
			modelName: "text-embedding-3-large",
			embeddingDimension: 3072,
			distanceMetric: "cosine",
			authType: "api_key",
			credentialRef: "env:OPENAI_API_KEY",
		},
	},
	{
		id: "nvidia-nv-embedqa-e5-v5",
		label: "NVIDIA nv-embedqa-e5-v5 (multilingual)",
		description:
			"Astra-bundled NIM. 1024 dimensions, cosine. Multilingual, retrieval-tuned. Auth is handled by Astra's KMS so no client-side API key is needed.",
		input: {
			name: "nvidia-nv-embedqa-e5-v5",
			description:
				"NVIDIA nvidia/nv-embedqa-e5-v5 (1024-dim, cosine). Multilingual, retrieval-tuned.",
			provider: "nvidia",
			modelName: "nvidia/nv-embedqa-e5-v5",
			embeddingDimension: 1024,
			distanceMetric: "cosine",
			authType: "none",
			credentialRef: null,
		},
	},
];

/** Chunking presets — mirror the runtime's `DEFAULT_SERVICES.chunking`. */
export const CHUNKING_PRESETS: readonly ChunkingPreset[] = [
	{
		id: "recursive-char-1000",
		label: "Recursive character (1000 chars / 150 overlap)",
		description:
			"Default. Honors paragraph, sentence, and word boundaries. Good for prose, markdown, mixed content.",
		input: {
			name: "recursive-char-1000",
			description:
				"Recursive character splitter (1000 chars / 150 overlap) honoring paragraph, sentence, and word boundaries.",
			engine: "langchain_ts",
			strategy: "recursive",
			chunkUnit: "characters",
			maxChunkSize: 1000,
			minChunkSize: 100,
			overlapSize: 150,
			overlapUnit: "characters",
			preserveStructure: true,
		},
	},
	{
		id: "recursive-char-500",
		label: "Recursive character (500 chars / 75 overlap)",
		description:
			"Small chunks for short notes and precise retrieval. Honors paragraph, sentence, and word boundaries.",
		input: {
			name: "recursive-char-500",
			description:
				"Small recursive character splitter (500 chars / 75 overlap) honoring paragraph, sentence, and word boundaries.",
			engine: "langchain_ts",
			strategy: "recursive",
			chunkUnit: "characters",
			maxChunkSize: 500,
			minChunkSize: 50,
			overlapSize: 75,
			overlapUnit: "characters",
			preserveStructure: true,
		},
	},
	{
		id: "recursive-char-2000",
		label: "Recursive character (2000 chars / 250 overlap)",
		description:
			"Larger chunks for long-form documentation and reports. Honors paragraph, sentence, and word boundaries.",
		input: {
			name: "recursive-char-2000",
			description:
				"Large recursive character splitter (2000 chars / 250 overlap) honoring paragraph, sentence, and word boundaries.",
			engine: "langchain_ts",
			strategy: "recursive",
			chunkUnit: "characters",
			maxChunkSize: 2000,
			minChunkSize: 150,
			overlapSize: 250,
			overlapUnit: "characters",
			preserveStructure: true,
		},
	},
	{
		id: "recursive-char-4000",
		label: "Recursive character (4000 chars / 400 overlap)",
		description:
			"Extra-large chunks for broad context retrieval. Honors paragraph, sentence, and word boundaries.",
		input: {
			name: "recursive-char-4000",
			description:
				"Extra-large recursive character splitter (4000 chars / 400 overlap) honoring paragraph, sentence, and word boundaries.",
			engine: "langchain_ts",
			strategy: "recursive",
			chunkUnit: "characters",
			maxChunkSize: 4000,
			minChunkSize: 250,
			overlapSize: 400,
			overlapUnit: "characters",
			preserveStructure: true,
		},
	},
	{
		id: "line-rows-1",
		label: "Line-based (one row per chunk)",
		description:
			"Default for CSV / JSONL / log files: every row becomes its own retrievable chunk. Recognises `\\n`, `\\r\\n`, and lone `\\r` line endings.",
		input: {
			name: "line-rows-1",
			description:
				"Line-based splitter — one row per chunk. Snaps to `\\n`, `\\r\\n`, or `\\r` boundaries.",
			engine: "langchain_ts",
			strategy: "line",
			chunkUnit: "rows",
			maxChunkSize: 1,
			minChunkSize: 0,
			overlapSize: 0,
			overlapUnit: "rows",
			preserveStructure: true,
		},
	},
];

/** Reranking presets. The runtime doesn't seed any today; these are
 * just dropdown helpers so an operator who wants Cohere reranking
 * doesn't have to type the model name. */
export const RERANKING_PRESETS: readonly RerankingPreset[] = [
	{
		id: "cohere-rerank-english-v3",
		label: "Cohere rerank-english-v3.0",
		description: "English-only reranker.",
		input: {
			name: "cohere-rerank-english-v3",
			description: "Cohere rerank-english-v3.0.",
			provider: "cohere",
			modelName: "rerank-english-v3.0",
		},
	},
	{
		id: "cohere-rerank-multilingual-v3",
		label: "Cohere rerank-multilingual-v3.0",
		description: "Multilingual reranker.",
		input: {
			name: "cohere-rerank-multilingual-v3",
			description: "Cohere rerank-multilingual-v3.0.",
			provider: "cohere",
			modelName: "rerank-multilingual-v3.0",
		},
	},
];

/** Sentinel value for "Custom" / "Other" entries in dropdowns. Keep
 * out of the legal provider/model namespaces above. */
export const CUSTOM_OPTION = "__custom__";
