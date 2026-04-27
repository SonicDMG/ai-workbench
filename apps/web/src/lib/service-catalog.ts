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

/** Provider names recognised by the runtime's embedding factory. */
export const EMBEDDING_PROVIDERS: readonly {
	readonly value: string;
	readonly label: string;
}[] = [
	{ value: "openai", label: "OpenAI" },
	{ value: "cohere", label: "Cohere" },
];

/** Model catalog per embedding provider — used to scope the model
 * dropdown once a provider is picked. Dim is the *native* dimension;
 * OpenAI's 3-* family supports truncation via the `dimensions` knob. */
export const EMBEDDING_MODELS: Readonly<
	Record<
		string,
		readonly { readonly value: string; readonly dimension: number }[]
	>
> = {
	openai: [
		{ value: "text-embedding-3-small", dimension: 1536 },
		{ value: "text-embedding-3-large", dimension: 3072 },
		{ value: "text-embedding-ada-002", dimension: 1536 },
	],
	cohere: [
		{ value: "embed-v4.0", dimension: 1024 },
		{ value: "embed-multilingual-v3.0", dimension: 1024 },
		{ value: "embed-english-v3.0", dimension: 1024 },
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
		{ value: "semantic", label: "Semantic" },
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
		id: "openai-text-embedding-3-small",
		label: "OpenAI text-embedding-3-small",
		description:
			"Default. 1536 dimensions, cosine. Astra `$vectorize`-eligible — server-side embedding when the workspace uses the Astra driver.",
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
		id: "cohere-embed-v4-multilingual",
		label: "Cohere embed-v4 (multilingual)",
		description:
			"Multilingual preset. 1024 dimensions, cosine. Astra `$vectorize`-eligible.",
		input: {
			name: "cohere-embed-v4-multilingual",
			description: "Cohere embed-v4.0 (1024-dim, cosine).",
			provider: "cohere",
			modelName: "embed-v4.0",
			embeddingDimension: 1024,
			distanceMetric: "cosine",
			authType: "api_key",
			credentialRef: "env:COHERE_API_KEY",
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
		},
	},
	{
		id: "line-2000",
		label: "Line-based (2000 chars, snaps to \\n)",
		description:
			"Default for CSV / JSONL. Snaps to `\\n` boundaries so rows stay intact; hard-splits any line longer than the limit.",
		input: {
			name: "line-2000",
			description:
				"Line-based splitter (2000 chars per chunk, snaps to `\\n` boundaries).",
			engine: "langchain_ts",
			strategy: "line",
			chunkUnit: "characters",
			maxChunkSize: 2000,
			minChunkSize: 0,
			overlapSize: 0,
			overlapUnit: "characters",
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
