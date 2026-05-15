import { z } from "zod";
import { getAuthToken } from "./authToken";
import {
	type AdoptableCollection,
	AdoptableCollectionListSchema,
	AgentPageSchema,
	type AgentRecord,
	AgentRecordSchema,
	type AgentTemplate,
	AgentTemplateListSchema,
	ApiKeyPageSchema,
	type ApiKeyRecord,
	type AstraCliInfo,
	AstraCliInfoSchema,
	type AstraCliInventory,
	AstraCliInventorySchema,
	type ChatMessage,
	ChatMessagePageSchema,
	ChunkingServicePageSchema,
	type ChunkingServiceRecord,
	ChunkingServiceRecordSchema,
	type ConnectSnippetsResponse,
	ConnectSnippetsResponseSchema,
	type ConnectTrafficResponse,
	ConnectTrafficResponseSchema,
	type ConnectVerifyResponse,
	ConnectVerifyResponseSchema,
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
	type CreatePrincipalInput,
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
	type KbIngestAsyncOrDuplicate,
	KbIngestAsyncOrDuplicateSchema,
	type KbIngestRequest,
	type KnowledgeBaseCreateResponse,
	KnowledgeBaseCreateResponseSchema,
	KnowledgeBasePageSchema,
	type KnowledgeBaseRecord,
	KnowledgeBaseRecordSchema,
	KnowledgeFilterPageSchema,
	type KnowledgeFilterRecord,
	KnowledgeFilterRecordSchema,
	LlmServicePageSchema,
	type LlmServiceRecord,
	LlmServiceRecordSchema,
	type PlaygroundCommandInput,
	type PlaygroundCommandResponse,
	PlaygroundCommandResponseSchema,
	PolicyAuditPageSchema,
	type PolicyAuditRecord,
	type PolicyCompilePreviewResponse,
	PolicyCompilePreviewResponseSchema,
	PrincipalPageSchema,
	type PrincipalRecord,
	PrincipalRecordSchema,
	RagDocumentPageSchema,
	type RagDocumentRecord,
	RagDocumentRecordSchema,
	RerankingServicePageSchema,
	type RerankingServiceRecord,
	RerankingServiceRecordSchema,
	type SendChatMessageInput,
	type SendChatMessageResponse,
	SendChatMessageResponseSchema,
	type TestConnectionResult,
	TestConnectionResultSchema,
	type UpdateAgentInput,
	type UpdateChunkingServiceInput,
	type UpdateConversationInput,
	type UpdateEmbeddingServiceInput,
	type UpdateKnowledgeBaseInput,
	type UpdateKnowledgeFilterInput,
	type UpdateLlmServiceInput,
	type UpdatePrincipalInput,
	type UpdateRerankingServiceInput,
	type UpdateWorkspaceInput,
	type Workspace,
	WorkspacePageSchema,
	WorkspaceRecordSchema,
} from "./schemas";
import { fetchAuthConfig, loginHref, refreshSession } from "./session";
import {
	getViewAsPrincipalForWorkspace,
	workspaceIdFromApiPath,
} from "./viewAs";

const BASE = "/api/v1";
const CLIENT_PAGE_LIMIT = 200;

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

/**
 * Detect the "your key is read-only" failure mode and rewrite the
 * server's literal message into something a non-engineer can act on.
 *
 * The runtime's `ForbiddenError` for a missing privilege scope
 * produces `"authenticated subject is missing required scope
 * 'write'"` — accurate, but every word of it is an internal term.
 * For the UI we'd rather say "your key is read-only" and point the
 * user at the API-keys panel.
 *
 * Match is narrow on purpose: only fires when the server confirms
 * `code === "forbidden"` AND the message mentions scope, so a
 * generic 403 (workspace not authorized, etc.) still surfaces its
 * own message.
 */
function looksLikeMissingWriteScope(err: ApiError): boolean {
	return (
		err.status === 403 &&
		err.code === "forbidden" &&
		/missing required scope|scope_required/i.test(err.message) &&
		/['"`]?write['"`]?/i.test(err.message)
	);
}

export function formatApiError(err: unknown): string {
	if (err instanceof ApiError) {
		if (looksLikeMissingWriteScope(err)) {
			return "This API key is read-only. Mint a key with the Read + Write scope to make changes.";
		}
		return `${err.code}: ${err.message}`;
	}
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

	// RLAC: when the "view as" picker has a value for this request's
	// workspace, send it on every request. Resolution is driven by
	// the request path itself, not by React lifecycle — that way the
	// first fetch from a freshly-loaded KB page gets the right
	// header even before the picker component has mounted. The
	// backend ignores the header unless auth is disabled, the caller
	// is a bootstrap operator, or `WB_DEV_MODE=1`.
	const workspaceForRequest = workspaceIdFromApiPath(path);
	const viewAs = getViewAsPrincipalForWorkspace(workspaceForRequest);
	const viewAsHeader: Record<string, string> = viewAs
		? { "x-view-as-principal": viewAs }
		: {};

	// Multipart bodies set their own `content-type` (with the
	// boundary) when the browser serializes them. Leaving the default
	// `application/json` in place would clobber that and the server
	// would reject the upload as malformed. Detect FormData bodies and
	// drop the default; explicit per-call headers always win.
	const isMultipart = init.body instanceof FormData;
	const defaultHeaders: Record<string, string> = isMultipart
		? { accept: "application/json" }
		: { "content-type": "application/json", accept: "application/json" };

	const res = await fetch(`${BASE}${path}`, {
		...init,
		credentials: "include",
		headers: {
			...defaultHeaders,
			...authHeader,
			...viewAsHeader,
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

interface PaginatedResponse<T> {
	items: T[];
	nextCursor: string | null;
}

function withPageQuery(path: string, cursor: string | null): string {
	const url = new URL(path, "https://workbench.local");
	if (!url.searchParams.has("limit")) {
		url.searchParams.set("limit", String(CLIENT_PAGE_LIMIT));
	}
	if (cursor) {
		url.searchParams.set("cursor", cursor);
	}
	return `${url.pathname}${url.search}`;
}

async function requestAllPages<T>(
	path: string,
	responseSchema: z.ZodType<PaginatedResponse<T>>,
): Promise<T[]> {
	const items: T[] = [];
	const seenCursors = new Set<string>();
	let cursor: string | null = null;

	for (;;) {
		const page: PaginatedResponse<T> = await request(
			withPageQuery(path, cursor),
			{ method: "GET" },
			responseSchema,
		);
		items.push(...page.items);

		if (!page.nextCursor) return items;
		if (seenCursors.has(page.nextCursor)) {
			throw new ApiError(
				500,
				"pagination_loop",
				"Server returned a repeated pagination cursor",
				"",
			);
		}
		seenCursors.add(page.nextCursor);
		cursor = page.nextCursor;
	}
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
	 * Full astra-cli inventory (every profile + the databases each can
	 * see, token-redacted). Drives the workspace onboarding picker so
	 * the user can choose a target profile + database in the UI rather
	 * than restarting with `ASTRA_PROFILE=…`. Same auth-free contract
	 * as `getAstraCliInfo`.
	 */
	getAstraCliInventory: async (): Promise<AstraCliInventory | null> => {
		try {
			const res = await fetch("/astra-cli/profiles", {
				credentials: "include",
				headers: { accept: "application/json" },
			});
			if (!res.ok) return null;
			const body = (await res.json()) as unknown;
			const parsed = AstraCliInventorySchema.safeParse(body);
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
		requestAllPages("/workspaces", WorkspacePageSchema),

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
		requestAllPages(`/workspaces/${workspaceId}/api-keys`, ApiKeyPageSchema),

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
					// Forward the picker's choice when present; the
					// server defaults to `['read', 'write']` if absent so
					// existing callers stay back-compat.
					...(input.scopes ? { scopes: input.scopes } : {}),
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

	/* -------- Connect (pluggability) -------- */

	getConnectSnippets: (
		workspaceId: string,
		opts: { knowledgeBaseId?: string | null; apiKeyEnvVar?: string } = {},
	): Promise<ConnectSnippetsResponse> => {
		const params = new URLSearchParams();
		if (opts.knowledgeBaseId) {
			params.set("knowledgeBaseId", opts.knowledgeBaseId);
		}
		if (opts.apiKeyEnvVar) {
			params.set("apiKeyEnvVar", opts.apiKeyEnvVar);
		}
		const qs = params.toString();
		return request(
			`/workspaces/${workspaceId}/connect/snippets${qs ? `?${qs}` : ""}`,
			{ method: "GET" },
			ConnectSnippetsResponseSchema,
		);
	},

	verifyConnectEndpoint: (
		workspaceId: string,
	): Promise<ConnectVerifyResponse> =>
		request(
			`/workspaces/${workspaceId}/connect/verify`,
			{ method: "POST" },
			ConnectVerifyResponseSchema,
		),

	getConnectTraffic: (
		workspaceId: string,
		opts: { limit?: number } = {},
	): Promise<ConnectTrafficResponse> => {
		const params = new URLSearchParams();
		if (opts.limit !== undefined) {
			params.set("limit", String(opts.limit));
		}
		const qs = params.toString();
		return request(
			`/workspaces/${workspaceId}/connect/traffic${qs ? `?${qs}` : ""}`,
			{ method: "GET" },
			ConnectTrafficResponseSchema,
		);
	},

	/* -------- Knowledge bases -------- */

	listKnowledgeBases: (workspaceId: string): Promise<KnowledgeBaseRecord[]> =>
		requestAllPages(
			`/workspaces/${workspaceId}/knowledge-bases`,
			KnowledgeBasePageSchema,
		),

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
	): Promise<KnowledgeBaseCreateResponse> => {
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
			KnowledgeBaseCreateResponseSchema,
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
		if (patch.description !== undefined)
			body.description = patch.description ? patch.description : null;
		if (patch.status !== undefined) body.status = patch.status;
		if (patch.rerankingServiceId !== undefined)
			body.rerankingServiceId = patch.rerankingServiceId;
		if (patch.language !== undefined)
			body.language = patch.language ? patch.language : null;
		// RLAC: pass the policy fields through verbatim. `null` clears
		// the DSL; `undefined` leaves it untouched. `policyEnabled` is
		// a plain boolean.
		if (patch.policyDsl !== undefined) body.policyDsl = patch.policyDsl;
		if (patch.policyEnabled !== undefined)
			body.policyEnabled = patch.policyEnabled;
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
		requestAllPages(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}/filters`,
			KnowledgeFilterPageSchema,
		),

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
		requestAllPages(
			`/workspaces/${workspaceId}/chunking-services`,
			ChunkingServicePageSchema,
		),

	createChunkingService: (
		workspaceId: string,
		input: CreateChunkingServiceInput,
	): Promise<ChunkingServiceRecord> =>
		request(
			`/workspaces/${workspaceId}/chunking-services`,
			{ method: "POST", body: JSON.stringify(stripEmptyStrings(input)) },
			ChunkingServiceRecordSchema,
		),

	updateChunkingService: (
		workspaceId: string,
		chunkingServiceId: string,
		patch: UpdateChunkingServiceInput,
	): Promise<ChunkingServiceRecord> =>
		request(
			`/workspaces/${workspaceId}/chunking-services/${chunkingServiceId}`,
			{ method: "PATCH", body: JSON.stringify(stripUndefined(patch)) },
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
		requestAllPages(
			`/workspaces/${workspaceId}/embedding-services`,
			EmbeddingServicePageSchema,
		),

	createEmbeddingService: (
		workspaceId: string,
		input: CreateEmbeddingServiceInput,
	): Promise<EmbeddingServiceRecord> =>
		request(
			`/workspaces/${workspaceId}/embedding-services`,
			{ method: "POST", body: JSON.stringify(stripEmptyStrings(input)) },
			EmbeddingServiceRecordSchema,
		),

	updateEmbeddingService: (
		workspaceId: string,
		embeddingServiceId: string,
		patch: UpdateEmbeddingServiceInput,
	): Promise<EmbeddingServiceRecord> =>
		request(
			`/workspaces/${workspaceId}/embedding-services/${embeddingServiceId}`,
			{ method: "PATCH", body: JSON.stringify(stripUndefined(patch)) },
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
		requestAllPages(
			`/workspaces/${workspaceId}/reranking-services`,
			RerankingServicePageSchema,
		),

	createRerankingService: (
		workspaceId: string,
		input: CreateRerankingServiceInput,
	): Promise<RerankingServiceRecord> =>
		request(
			`/workspaces/${workspaceId}/reranking-services`,
			{ method: "POST", body: JSON.stringify(stripEmptyStrings(input)) },
			RerankingServiceRecordSchema,
		),

	updateRerankingService: (
		workspaceId: string,
		rerankingServiceId: string,
		patch: UpdateRerankingServiceInput,
	): Promise<RerankingServiceRecord> =>
		request(
			`/workspaces/${workspaceId}/reranking-services/${rerankingServiceId}`,
			{ method: "PATCH", body: JSON.stringify(stripUndefined(patch)) },
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
		requestAllPages(`/workspaces/${workspaceId}/agents`, AgentPageSchema),

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

	/* -------- Agent templates (catalog) -------- */

	listAgentTemplates: (workspaceId: string): Promise<AgentTemplate[]> =>
		request(
			`/workspaces/${workspaceId}/agent-templates`,
			{ method: "GET" },
			AgentTemplateListSchema,
		).then((res) => res.items),

	createAgentFromTemplate: (
		workspaceId: string,
		templateId: string,
	): Promise<AgentRecord> =>
		request(
			`/workspaces/${workspaceId}/agents/from-template`,
			{ method: "POST", body: JSON.stringify({ templateId }) },
			AgentRecordSchema,
		),

	/* -------- Conversations (agent-scoped) -------- */

	listConversations: (
		workspaceId: string,
		agentId: string,
	): Promise<ConversationRecord[]> =>
		requestAllPages(
			`/workspaces/${workspaceId}/agents/${agentId}/conversations`,
			ConversationPageSchema,
		),

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
		requestAllPages(
			`/workspaces/${workspaceId}/agents/${agentId}/conversations/${conversationId}/messages`,
			ChatMessagePageSchema,
		),

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
		requestAllPages(
			`/workspaces/${workspaceId}/llm-services`,
			LlmServicePageSchema,
		),

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
		requestAllPages(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}/documents`,
			RagDocumentPageSchema,
		),

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

	updateKbDocument: (
		workspaceId: string,
		kbId: string,
		documentId: string,
		patch: {
			readonly sourceFilename?: string | null;
			readonly visibleTo?: readonly string[] | null;
			readonly ownerPrincipalId?: string | null;
		},
	): Promise<RagDocumentRecord> => {
		const body: Record<string, unknown> = {};
		if (patch.sourceFilename !== undefined) {
			body.sourceFilename = patch.sourceFilename;
		}
		if (patch.visibleTo !== undefined) {
			body.visibleTo = patch.visibleTo === null ? null : [...patch.visibleTo];
		}
		if (patch.ownerPrincipalId !== undefined) {
			body.ownerPrincipalId = patch.ownerPrincipalId;
		}
		return request(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}/documents/${documentId}`,
			{ method: "PATCH", body: JSON.stringify(body) },
			RagDocumentRecordSchema,
		);
	},

	executePlaygroundCommand: (
		workspaceId: string,
		input: PlaygroundCommandInput,
	): Promise<PlaygroundCommandResponse> =>
		request(
			`/workspaces/${workspaceId}/playground/execute`,
			{ method: "POST", body: JSON.stringify(input) },
			PlaygroundCommandResponseSchema,
		),

	/* -------- Ingest + jobs -------- */

	kbIngestAsync: (
		workspaceId: string,
		kbId: string,
		input: KbIngestRequest,
	): Promise<KbIngestAsyncOrDuplicate> =>
		request(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}/ingest?async=true`,
			{ method: "POST", body: JSON.stringify(input) },
			KbIngestAsyncOrDuplicateSchema,
		),

	/**
	 * Ingest a binary file (PDF, DOCX, or text) via the multipart route.
	 * The server runs the bytes through the configured extractor
	 * (native by default; docling-serve when `DOCLING_URL` is set or
	 * when `parser: "docling"` is forced) and feeds the resulting
	 * plain text into the same ingest pipeline as `kbIngestAsync`,
	 * returning the same response shape.
	 */
	kbIngestFileAsync: (
		workspaceId: string,
		kbId: string,
		params: {
			readonly file: File | Blob;
			readonly filename: string;
			readonly parser?: "auto" | "native" | "docling";
			readonly metadata?: Readonly<Record<string, string>>;
			readonly overwriteOnNameConflict?: boolean;
			/** RLAC: principal ids (or `"*"`) that may read this doc. */
			readonly visibleTo?: readonly string[];
			/** RLAC: provenance only. */
			readonly ownerPrincipalId?: string;
		},
	): Promise<KbIngestAsyncOrDuplicate> => {
		const form = new FormData();
		form.append("file", params.file, params.filename);
		if (params.parser) form.append("parser", params.parser);
		if (params.metadata)
			form.append("metadata", JSON.stringify(params.metadata));
		if (params.overwriteOnNameConflict)
			form.append("overwriteOnNameConflict", "true");
		if (params.visibleTo)
			form.append("visibleTo", JSON.stringify([...params.visibleTo]));
		if (params.ownerPrincipalId)
			form.append("ownerPrincipalId", params.ownerPrincipalId);
		return request(
			`/workspaces/${workspaceId}/knowledge-bases/${kbId}/ingest/file?async=true`,
			{ method: "POST", body: form },
			KbIngestAsyncOrDuplicateSchema,
		);
	},

	getJob: (workspaceId: string, jobId: string): Promise<JobRecord> =>
		request(
			`/workspaces/${workspaceId}/jobs/${jobId}`,
			{ method: "GET" },
			JobRecordSchema,
		),

	/* ====== RLAC prototype ====== */

	listPrincipals: (workspaceId: string): Promise<PrincipalRecord[]> =>
		requestAllPages(
			`/workspaces/${workspaceId}/principals`,
			PrincipalPageSchema,
		),

	createPrincipal: (
		workspaceId: string,
		input: CreatePrincipalInput,
	): Promise<PrincipalRecord> =>
		request(
			`/workspaces/${workspaceId}/principals`,
			{ method: "POST", body: JSON.stringify(input) },
			PrincipalRecordSchema,
		),

	updatePrincipal: (
		workspaceId: string,
		principalId: string,
		patch: UpdatePrincipalInput,
	): Promise<PrincipalRecord> =>
		request(
			`/workspaces/${workspaceId}/principals/${encodeURIComponent(principalId)}`,
			{ method: "PATCH", body: JSON.stringify(patch) },
			PrincipalRecordSchema,
		),

	deletePrincipal: (workspaceId: string, principalId: string): Promise<void> =>
		request(
			`/workspaces/${workspaceId}/principals/${encodeURIComponent(principalId)}`,
			{ method: "DELETE" },
			null,
		),

	compilePolicy: (
		workspaceId: string,
		params: { readonly dsl: string; readonly principalId?: string | null },
	): Promise<PolicyCompilePreviewResponse> =>
		request(
			`/workspaces/${workspaceId}/policy/compile-preview`,
			{
				method: "POST",
				body: JSON.stringify({
					dsl: params.dsl,
					...(params.principalId ? { principalId: params.principalId } : {}),
				}),
			},
			PolicyCompilePreviewResponseSchema,
		),

	listPolicyAudit: (
		workspaceId: string,
		query: {
			readonly principalId?: string;
			readonly knowledgeBaseId?: string;
			readonly limit?: number;
		} = {},
	): Promise<PolicyAuditRecord[]> => {
		const params = new URLSearchParams();
		if (query.principalId) params.set("principalId", query.principalId);
		if (query.knowledgeBaseId)
			params.set("knowledgeBaseId", query.knowledgeBaseId);
		if (query.limit !== undefined) params.set("limit", String(query.limit));
		const qs = params.toString();
		return requestAllPages(
			`/workspaces/${workspaceId}/policy/audit${qs ? `?${qs}` : ""}`,
			PolicyAuditPageSchema,
		);
	},
};

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
	// RLAC master switch. Same forwarding-the-field-or-leaving-it-out
	// pattern as the rest of the patch shape.
	if (patch.rlacEnabled !== undefined) out.rlacEnabled = patch.rlacEnabled;
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
