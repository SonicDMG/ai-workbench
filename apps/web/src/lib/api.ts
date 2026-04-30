import { z } from "zod";
import { getAuthToken } from "./authToken";
import {
	type AdoptableCollection,
	AdoptableCollectionListSchema,
	AgentPageSchema,
	type AgentRecord,
	AgentRecordSchema,
	ApiKeyPageSchema,
	type ApiKeyRecord,
	type AstraCliInfo,
	AstraCliInfoSchema,
	type ChatMessage,
	ChatMessagePageSchema,
	ChunkingServicePageSchema,
	type ChunkingServiceRecord,
	ChunkingServiceRecordSchema,
	ConversationPageSchema,
	type ConversationRecord,
	ConversationRecordSchema,
	type CreateAgentInput,
	type CreateApiKeyInput,
	type CreateChunkingServiceInput,
	type CreateConversationInput,
	type CreatedApiKeyResponse,
	CreatedApiKeyResponseSchema,
	type CreateEmbeddingServiceInput,
	type CreateKnowledgeBaseInput,
	type CreateKnowledgeFilterInput,
	type CreateLlmServiceInput,
	type CreateRerankingServiceInput,
	type CreateWorkspaceInput,
	type DocumentChunk,
	DocumentChunkSchema,
	EmbeddingServicePageSchema,
	type EmbeddingServiceRecord,
	EmbeddingServiceRecordSchema,
	ErrorEnvelopeSchema,
	type Features,
	FeaturesSchema,
	type JobRecord,
	JobRecordSchema,
	type KbAsyncIngestResponse,
	KbAsyncIngestResponseSchema,
	type KbIngestRequest,
	KnowledgeBasePageSchema,
	type KnowledgeBaseRecord,
	KnowledgeBaseRecordSchema,
	KnowledgeFilterPageSchema,
	type KnowledgeFilterRecord,
	KnowledgeFilterRecordSchema,
	LlmServicePageSchema,
	type LlmServiceRecord,
	LlmServiceRecordSchema,
	RagDocumentPageSchema,
	type RagDocumentRecord,
	RerankingServicePageSchema,
	type RerankingServiceRecord,
	RerankingServiceRecordSchema,
	type SearchHit,
	SearchHitSchema,
	type SendChatMessageInput,
	type SendChatMessageResponse,
	SendChatMessageResponseSchema,
	type TestConnectionResult,
	TestConnectionResultSchema,
	type UpdateAgentInput,
	type UpdateConversationInput,
	type UpdateKnowledgeBaseInput,
	type UpdateKnowledgeFilterInput,
	type UpdateLlmServiceInput,
	type UpdateWorkspaceInput,
	type Workspace,
	WorkspacePageSchema,
	WorkspaceRecordSchema,
} from "./schemas";
import { fetchAuthConfig, loginHref, refreshSession } from "./session";

const BASE = "/api/v1";

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly requestId: string;

	constructor(
		status: number,
		code: string,
		message: string,
		requestId: string,
	) {
		super(message);
		this.status = status;
		this.code = code;
		this.requestId = requestId;
	}
}

export function formatApiError(err: unknown): string {
	if (err instanceof ApiError) return `${err.code}: ${err.message}`;
	if (err instanceof Error) return err.message;
	return "Unknown error";
}

async function request<T>(
	path: string,
	init: RequestInit,
	responseSchema: z.ZodType<T> | null,
	opts: { readonly retryAfterRefresh?: boolean } = {},
): Promise<T> {
	const token = getAuthToken();
	const authHeader: Record<string, string> = token
		? { authorization: `Bearer ${token}` }
		: {};

	const res = await fetch(`${BASE}${path}`, {
		...init,
		credentials: "include",
		headers: {
			"content-type": "application/json",
			accept: "application/json",
			...authHeader,
			...(init.headers ?? {}),
		},
	});

	if (res.status === 204) return undefined as T;

	const text = await res.text();
	const body: unknown = text.length > 0 ? JSON.parse(text) : null;

	if (res.status === 401 && !token) {
		if (opts.retryAfterRefresh !== false && (await trySilentRefresh())) {
			return request(path, init, responseSchema, { retryAfterRefresh: false });
		}
		await maybeRedirectToLogin();
	}

	if (!res.ok) {
		const parsed = ErrorEnvelopeSchema.safeParse(body);
		if (parsed.success) {
			throw new ApiError(
				res.status,
				parsed.data.error.code,
				parsed.data.error.message,
				parsed.data.error.requestId,
			);
		}
		throw new ApiError(
			res.status,
			"unknown_error",
			`${res.status} ${res.statusText}`,
			"",
		);
	}

	if (responseSchema === null) return undefined as T;
	return responseSchema.parse(body);
}

let inFlightRefresh: Promise<boolean> | null = null;
async function trySilentRefresh(): Promise<boolean> {
	if (inFlightRefresh) return inFlightRefresh;
	inFlightRefresh = (async () => {
		try {
			const cfg = await fetchAuthConfig();
			if (!cfg?.refreshPath) return false;
			const result = await refreshSession(cfg.refreshPath);
			return result !== null;
		} catch {
			return false;
		}
	})();
	try {
		return await inFlightRefresh;
	} finally {
		inFlightRefresh = null;
	}
}

let redirecting = false;
async function maybeRedirectToLogin(): Promise<void> {
	if (redirecting) return;
	redirecting = true;
	try {
		const cfg = await fetchAuthConfig();
		if (cfg?.modes.login && cfg.loginPath) {
			const here = window.location.pathname + window.location.search;
			window.location.assign(loginHref(cfg.loginPath, here));
		}
	} catch {
		// surface the original 401
	} finally {
		redirecting = false;
	}
}

export const api = {
	/**
	 * Discovery endpoint — reports whether the runtime resolved an
	 * Astra database from a configured `astra` CLI profile at startup.
	 * Lives at `/astra-cli` (not `/api/v1/astra-cli`) so the onboarding
	 * page can call it before the user has any workspaces or auth set up.
	 */
	getAstraCliInfo: async (): Promise<AstraCliInfo | null> => {
		try {
			const res = await fetch("/astra-cli", {
				credentials: "include",
				headers: { accept: "application/json" },
			});
			if (!res.ok) return null;
			const body = (await res.json()) as unknown;
			const parsed = AstraCliInfoSchema.safeParse(body);
			return parsed.success ? parsed.data : null;
		} catch {
			return null;
		}
	},

	/**
	 * Runtime feature flags. Lives outside `/api/v1` (see also
	 * `/astra-cli`) so the UI can read it without auth, and falls back
	 * to all-disabled when the endpoint is unreachable so older runtimes
	 * keep working.
	 */
	getFeatures: async (): Promise<Features> => {
		const fallback: Features = { mcp: { enabled: false, baseUrl: null } };
		try {
			const res = await fetch("/features", {
				credentials: "include",
				headers: { accept: "application/json" },
			});
			if (!res.ok) return fallback;
			const body = (await res.json()) as unknown;
			const parsed = FeaturesSchema.safeParse(body);
			return parsed.success ? parsed.data : fallback;
		} catch {
			return fallback;
		}
	},

	listWorkspaces: (): Promise<Workspace[]> =>
		request("/workspaces", { method: "GET" }, WorkspacePageSchema).then(
			(page) => page.items,
		),

	getWorkspace: (workspaceId: string): Promise<Workspace> =>
		request(
			`/workspaces/${workspaceId}`,
			{ method: "GET" },
			WorkspaceRecordSchema,
		),

	createWorkspace: (input: CreateWorkspaceInput): Promise<Workspace> =>
		request(
			"/workspaces",
			{ method: "POST", body: JSON.stringify(normalizeCreate(input)) },
			WorkspaceRecordSchema,
		),

	updateWorkspace: (
		workspaceId: string,
		patch: UpdateWorkspaceInput,
	): Promise<Workspace> =>
		request(
			`/workspaces/${workspaceId}`,
			{ method: "PATCH", body: JSON.stringify(normalizeUpdate(patch)) },
			WorkspaceRecordSchema,
		),

	deleteWorkspace: (workspaceId: string): Promise<void> =>
		request(`/workspaces/${workspaceId}`, { method: "DELETE" }, null),

	testConnection: (workspaceId: string): Promise<TestConnectionResult> =>
		request(
			`/workspaces/${workspaceId}/test-connection`,
			{ method: "POST" },
			TestConnectionResultSchema,
		),

	listApiKeys: (workspaceId: string): Promise<ApiKeyRecord[]> =>
		request(
			`/workspaces/${workspaceId}/api-keys`,
			{ method: "GET" },
			ApiKeyPageSchema,
		).then((page) => page.items),

	createApiKey: (
		workspaceId: string,
		input: CreateApiKeyInput,
	): Promise<CreatedApiKeyResponse> =>
		request(
			`/workspaces/${workspaceId}/api-keys`,
			{
				method: "POST",
				body: JSON.stringify({
					label: input.label.trim(),
					expiresAt: input.expiresAt ?? null,
				}),
			},
			CreatedApiKeyResponseSchema,
		),

	revokeApiKey: (workspaceId: string, keyId: string): Promise<void> =>
		request(
			`/workspaces/${workspaceId}/api-keys/${keyId}`,
			{ method: "DELETE" },
			null,
		),

	/* -------- Knowledge bases -------- */

	listKnowledgeBases: (workspaceId: string): Promise<KnowledgeBaseRecord[]> =>
		request(
			`/workspaces/${workspaceId}/knowledge-bases`,
			{ method: "GET" },
			KnowledgeBasePageSchema,
		).then((page) => page.items),

	getKnowledgeBase: (
		workspaceId: string,
		kbId: string,
	): Promise<KnowledgeBaseRecord> =>
		request(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}`,
			{ method: "GET" },
			KnowledgeBaseRecordSchema,
		),

	createKnowledgeBase: (
		workspaceId: string,
		input: CreateKnowledgeBaseInput,
	): Promise<KnowledgeBaseRecord> => {
		const body: Record<string, unknown> = {
			name: input.name,
			description: input.description ? input.description : null,
			embeddingServiceId: input.embeddingServiceId,
			chunkingServiceId: input.chunkingServiceId,
			rerankingServiceId: input.rerankingServiceId ?? null,
			language: input.language ? input.language : null,
		};
		if (input.attach) {
			body.attach = true;
			body.vectorCollection = input.vectorCollection ?? null;
		}
		return request(
			`/workspaces/${workspaceId}/knowledge-bases`,
			{ method: "POST", body: JSON.stringify(body) },
			KnowledgeBaseRecordSchema,
		);
	},

	listAdoptableCollections: (
		workspaceId: string,
	): Promise<AdoptableCollection[]> =>
		request(
			`/workspaces/${workspaceId}/adoptable-collections`,
			{ method: "GET" },
			AdoptableCollectionListSchema,
		).then((page) => page.items),

	updateKnowledgeBase: (
		workspaceId: string,
		kbId: string,
		patch: UpdateKnowledgeBaseInput,
	): Promise<KnowledgeBaseRecord> => {
		const body: Record<string, unknown> = {};
		if (patch.name !== undefined) body.name = patch.name;
		if (patch.description !== undefined)
			body.description = patch.description ? patch.description : null;
		if (patch.status !== undefined) body.status = patch.status;
		if (patch.rerankingServiceId !== undefined)
			body.rerankingServiceId = patch.rerankingServiceId;
		if (patch.language !== undefined)
			body.language = patch.language ? patch.language : null;
		return request(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}`,
			{ method: "PATCH", body: JSON.stringify(body) },
			KnowledgeBaseRecordSchema,
		);
	},

	deleteKnowledgeBase: (workspaceId: string, kbId: string): Promise<void> =>
		request(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}`,
			{ method: "DELETE" },
			null,
		),

	listKnowledgeFilters: (
		workspaceId: string,
		kbId: string,
	): Promise<KnowledgeFilterRecord[]> =>
		request(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}/filters`,
			{ method: "GET" },
			KnowledgeFilterPageSchema,
		).then((page) => page.items),

	getKnowledgeFilter: (
		workspaceId: string,
		kbId: string,
		filterId: string,
	): Promise<KnowledgeFilterRecord> =>
		request(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}/filters/${filterId}`,
			{ method: "GET" },
			KnowledgeFilterRecordSchema,
		),

	createKnowledgeFilter: (
		workspaceId: string,
		kbId: string,
		input: CreateKnowledgeFilterInput,
	): Promise<KnowledgeFilterRecord> =>
		request(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}/filters`,
			{
				method: "POST",
				body: JSON.stringify({
					name: input.name,
					description: input.description ? input.description : null,
					filter: input.filter,
				}),
			},
			KnowledgeFilterRecordSchema,
		),

	updateKnowledgeFilter: (
		workspaceId: string,
		kbId: string,
		filterId: string,
		patch: UpdateKnowledgeFilterInput,
	): Promise<KnowledgeFilterRecord> => {
		const body: Record<string, unknown> = {};
		if (patch.name !== undefined) body.name = patch.name;
		if (patch.description !== undefined)
			body.description = patch.description ? patch.description : null;
		if (patch.filter !== undefined) body.filter = patch.filter;
		return request(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}/filters/${filterId}`,
			{ method: "PATCH", body: JSON.stringify(body) },
			KnowledgeFilterRecordSchema,
		);
	},

	deleteKnowledgeFilter: (
		workspaceId: string,
		kbId: string,
		filterId: string,
	): Promise<void> =>
		request(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}/filters/${filterId}`,
			{ method: "DELETE" },
			null,
		),

	/* -------- Execution services -------- */

	listChunkingServices: (
		workspaceId: string,
	): Promise<ChunkingServiceRecord[]> =>
		request(
			`/workspaces/${workspaceId}/chunking-services`,
			{ method: "GET" },
			ChunkingServicePageSchema,
		).then((page) => page.items),

	createChunkingService: (
		workspaceId: string,
		input: CreateChunkingServiceInput,
	): Promise<ChunkingServiceRecord> =>
		request(
			`/workspaces/${workspaceId}/chunking-services`,
			{ method: "POST", body: JSON.stringify(stripEmptyStrings(input)) },
			ChunkingServiceRecordSchema,
		),

	deleteChunkingService: (
		workspaceId: string,
		chunkingServiceId: string,
	): Promise<void> =>
		request(
			`/workspaces/${workspaceId}/chunking-services/${chunkingServiceId}`,
			{ method: "DELETE" },
			null,
		),

	listEmbeddingServices: (
		workspaceId: string,
	): Promise<EmbeddingServiceRecord[]> =>
		request(
			`/workspaces/${workspaceId}/embedding-services`,
			{ method: "GET" },
			EmbeddingServicePageSchema,
		).then((page) => page.items),

	createEmbeddingService: (
		workspaceId: string,
		input: CreateEmbeddingServiceInput,
	): Promise<EmbeddingServiceRecord> =>
		request(
			`/workspaces/${workspaceId}/embedding-services`,
			{ method: "POST", body: JSON.stringify(stripEmptyStrings(input)) },
			EmbeddingServiceRecordSchema,
		),

	deleteEmbeddingService: (
		workspaceId: string,
		embeddingServiceId: string,
	): Promise<void> =>
		request(
			`/workspaces/${workspaceId}/embedding-services/${embeddingServiceId}`,
			{ method: "DELETE" },
			null,
		),

	listRerankingServices: (
		workspaceId: string,
	): Promise<RerankingServiceRecord[]> =>
		request(
			`/workspaces/${workspaceId}/reranking-services`,
			{ method: "GET" },
			RerankingServicePageSchema,
		).then((page) => page.items),

	createRerankingService: (
		workspaceId: string,
		input: CreateRerankingServiceInput,
	): Promise<RerankingServiceRecord> =>
		request(
			`/workspaces/${workspaceId}/reranking-services`,
			{ method: "POST", body: JSON.stringify(stripEmptyStrings(input)) },
			RerankingServiceRecordSchema,
		),

	deleteRerankingService: (
		workspaceId: string,
		rerankingServiceId: string,
	): Promise<void> =>
		request(
			`/workspaces/${workspaceId}/reranking-services/${rerankingServiceId}`,
			{ method: "DELETE" },
			null,
		),

	/* -------- Agents -------- */

	listAgents: (workspaceId: string): Promise<AgentRecord[]> =>
		request(
			`/workspaces/${workspaceId}/agents`,
			{ method: "GET" },
			AgentPageSchema,
		).then((page) => page.items),

	getAgent: (workspaceId: string, agentId: string): Promise<AgentRecord> =>
		request(
			`/workspaces/${workspaceId}/agents/${agentId}`,
			{ method: "GET" },
			AgentRecordSchema,
		),

	createAgent: (
		workspaceId: string,
		input: CreateAgentInput,
	): Promise<AgentRecord> =>
		request(
			`/workspaces/${workspaceId}/agents`,
			{ method: "POST", body: JSON.stringify(stripUndefined(input)) },
			AgentRecordSchema,
		),

	updateAgent: (
		workspaceId: string,
		agentId: string,
		patch: UpdateAgentInput,
	): Promise<AgentRecord> =>
		request(
			`/workspaces/${workspaceId}/agents/${agentId}`,
			{ method: "PATCH", body: JSON.stringify(stripUndefined(patch)) },
			AgentRecordSchema,
		),

	deleteAgent: (workspaceId: string, agentId: string): Promise<void> =>
		request(
			`/workspaces/${workspaceId}/agents/${agentId}`,
			{ method: "DELETE" },
			null,
		),

	/* -------- Conversations (agent-scoped) -------- */

	listConversations: (
		workspaceId: string,
		agentId: string,
	): Promise<ConversationRecord[]> =>
		request(
			`/workspaces/${workspaceId}/agents/${agentId}/conversations`,
			{ method: "GET" },
			ConversationPageSchema,
		).then((page) => page.items),

	getConversation: (
		workspaceId: string,
		agentId: string,
		conversationId: string,
	): Promise<ConversationRecord> =>
		request(
			`/workspaces/${workspaceId}/agents/${agentId}/conversations/${conversationId}`,
			{ method: "GET" },
			ConversationRecordSchema,
		),

	createConversation: (
		workspaceId: string,
		agentId: string,
		input: CreateConversationInput,
	): Promise<ConversationRecord> => {
		const body: Record<string, unknown> = {};
		if (input.conversationId !== undefined)
			body.conversationId = input.conversationId;
		if (input.title !== undefined) body.title = input.title;
		if (input.knowledgeBaseIds !== undefined)
			body.knowledgeBaseIds = input.knowledgeBaseIds;
		return request(
			`/workspaces/${workspaceId}/agents/${agentId}/conversations`,
			{ method: "POST", body: JSON.stringify(body) },
			ConversationRecordSchema,
		);
	},

	updateConversation: (
		workspaceId: string,
		agentId: string,
		conversationId: string,
		patch: UpdateConversationInput,
	): Promise<ConversationRecord> => {
		const body: Record<string, unknown> = {};
		if (patch.title !== undefined) body.title = patch.title;
		if (patch.knowledgeBaseIds !== undefined)
			body.knowledgeBaseIds = patch.knowledgeBaseIds;
		return request(
			`/workspaces/${workspaceId}/agents/${agentId}/conversations/${conversationId}`,
			{ method: "PATCH", body: JSON.stringify(body) },
			ConversationRecordSchema,
		);
	},

	deleteConversation: (
		workspaceId: string,
		agentId: string,
		conversationId: string,
	): Promise<void> =>
		request(
			`/workspaces/${workspaceId}/agents/${agentId}/conversations/${conversationId}`,
			{ method: "DELETE" },
			null,
		),

	listConversationMessages: (
		workspaceId: string,
		agentId: string,
		conversationId: string,
	): Promise<ChatMessage[]> =>
		request(
			`/workspaces/${workspaceId}/agents/${agentId}/conversations/${conversationId}/messages`,
			{ method: "GET" },
			ChatMessagePageSchema,
		).then((page) => page.items),

	sendConversationMessage: (
		workspaceId: string,
		agentId: string,
		conversationId: string,
		input: SendChatMessageInput,
	): Promise<SendChatMessageResponse> =>
		request(
			`/workspaces/${workspaceId}/agents/${agentId}/conversations/${conversationId}/messages`,
			{ method: "POST", body: JSON.stringify(input) },
			SendChatMessageResponseSchema,
		),

	/* -------- LLM services -------- */

	listLlmServices: (workspaceId: string): Promise<LlmServiceRecord[]> =>
		request(
			`/workspaces/${workspaceId}/llm-services`,
			{ method: "GET" },
			LlmServicePageSchema,
		).then((page) => page.items),

	getLlmService: (
		workspaceId: string,
		llmServiceId: string,
	): Promise<LlmServiceRecord> =>
		request(
			`/workspaces/${workspaceId}/llm-services/${llmServiceId}`,
			{ method: "GET" },
			LlmServiceRecordSchema,
		),

	createLlmService: (
		workspaceId: string,
		input: CreateLlmServiceInput,
	): Promise<LlmServiceRecord> =>
		request(
			`/workspaces/${workspaceId}/llm-services`,
			{ method: "POST", body: JSON.stringify(stripUndefined(input)) },
			LlmServiceRecordSchema,
		),

	updateLlmService: (
		workspaceId: string,
		llmServiceId: string,
		patch: UpdateLlmServiceInput,
	): Promise<LlmServiceRecord> =>
		request(
			`/workspaces/${workspaceId}/llm-services/${llmServiceId}`,
			{ method: "PATCH", body: JSON.stringify(stripUndefined(patch)) },
			LlmServiceRecordSchema,
		),

	deleteLlmService: (
		workspaceId: string,
		llmServiceId: string,
	): Promise<void> =>
		request(
			`/workspaces/${workspaceId}/llm-services/${llmServiceId}`,
			{ method: "DELETE" },
			null,
		),

	/* -------- KB documents -------- */

	listKbDocuments: (
		workspaceId: string,
		kbId: string,
	): Promise<RagDocumentRecord[]> =>
		request(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}/documents`,
			{ method: "GET" },
			RagDocumentPageSchema,
		).then((page) => page.items),

	listKbDocumentChunks: (
		workspaceId: string,
		kbId: string,
		documentId: string,
		opts?: { limit?: number },
	): Promise<DocumentChunk[]> => {
		const qs = opts?.limit ? `?limit=${opts.limit}` : "";
		return request(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}/documents/${documentId}/chunks${qs}`,
			{ method: "GET" },
			z.array(DocumentChunkSchema),
		);
	},

	deleteKbDocument: (
		workspaceId: string,
		kbId: string,
		documentId: string,
	): Promise<void> =>
		request(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}/documents/${documentId}`,
			{ method: "DELETE" },
			null,
		),

	/* -------- KB data plane -------- */

	kbSearch: (
		workspaceId: string,
		kbId: string,
		input: PlaygroundSearchInput,
	): Promise<SearchHit[]> =>
		request(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}/search`,
			{ method: "POST", body: JSON.stringify(input) },
			z.array(SearchHitSchema),
		),

	/* -------- Ingest + jobs -------- */

	kbIngestAsync: (
		workspaceId: string,
		kbId: string,
		input: KbIngestRequest,
	): Promise<KbAsyncIngestResponse> =>
		request(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}/ingest?async=true`,
			{ method: "POST", body: JSON.stringify(input) },
			KbAsyncIngestResponseSchema,
		),

	getJob: (workspaceId: string, jobId: string): Promise<JobRecord> =>
		request(
			`/workspaces/${workspaceId}/jobs/${jobId}`,
			{ method: "GET" },
			JobRecordSchema,
		),
};

export interface PlaygroundSearchInput {
	readonly text?: string;
	readonly vector?: number[];
	readonly topK?: number;
	readonly filter?: Record<string, unknown>;
	readonly includeEmbeddings?: boolean;
	readonly hybrid?: boolean;
	readonly lexicalWeight?: number;
	readonly rerank?: boolean;
}

function normalizeCreate(input: CreateWorkspaceInput) {
	return {
		name: input.name,
		kind: input.kind,
		url: input.url ? input.url : null,
		keyspace: input.keyspace ? input.keyspace : null,
		credentials: pruneCredentials(input.credentials),
	};
}

function normalizeUpdate(patch: UpdateWorkspaceInput) {
	const out: Record<string, unknown> = {};
	if (patch.name !== undefined) out.name = patch.name;
	if (patch.url !== undefined) out.url = patch.url ? patch.url : null;
	if (patch.keyspace !== undefined)
		out.keyspace = patch.keyspace ? patch.keyspace : null;
	if (patch.credentials !== undefined)
		out.credentials = pruneCredentials(patch.credentials);
	return out;
}

function pruneCredentials(
	creds: Record<string, string> | undefined,
): Record<string, string> | undefined {
	if (!creds) return undefined;
	const entries = Object.entries(creds).filter(
		([k, v]) => k.trim().length > 0 && v.trim().length > 0,
	);
	if (entries.length === 0) return undefined;
	return Object.fromEntries(entries);
}

/**
 * Drop empty-string entries before sending — the form layer uses ""
 * as the "not set" sentinel for optional text fields, but the backend
 * expects either a real value or the field to be absent.
 */
function stripEmptyStrings<T extends Record<string, unknown>>(
	input: T,
): Partial<T> {
	const out: Partial<T> = {};
	for (const [k, v] of Object.entries(input)) {
		if (v === "" || v === null || v === undefined) continue;
		(out as Record<string, unknown>)[k] = v;
	}
	return out;
}

/**
 * Drop only `undefined` entries — preserves explicit `null` (which is
 * meaningful for nullable fields like `description` or `llmServiceId`)
 * and empty arrays. Used by routes whose input schema accepts `null`
 * to mean "clear this field".
 */
function stripUndefined<T extends Record<string, unknown>>(
	input: T,
): Partial<T> {
	const out: Partial<T> = {};
	for (const [k, v] of Object.entries(input)) {
		if (v === undefined) continue;
		(out as Record<string, unknown>)[k] = v;
	}
	return out;
}
