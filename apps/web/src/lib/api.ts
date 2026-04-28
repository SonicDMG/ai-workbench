import { z } from "zod";
import { getAuthToken } from "./authToken";
import {
	ApiKeyPageSchema,
	type ApiKeyRecord,
	type AstraCliInfo,
	AstraCliInfoSchema,
	ChunkingServicePageSchema,
	type ChunkingServiceRecord,
	ChunkingServiceRecordSchema,
	type CreateApiKeyInput,
	type CreateChunkingServiceInput,
	type CreatedApiKeyResponse,
	CreatedApiKeyResponseSchema,
	type CreateEmbeddingServiceInput,
	type CreateKnowledgeBaseInput,
	type CreateKnowledgeFilterInput,
	type CreateRerankingServiceInput,
	type CreateWorkspaceInput,
	type DocumentChunk,
	DocumentChunkSchema,
	EmbeddingServicePageSchema,
	type EmbeddingServiceRecord,
	EmbeddingServiceRecordSchema,
	ErrorEnvelopeSchema,
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
	RagDocumentPageSchema,
	type RagDocumentRecord,
	RerankingServicePageSchema,
	type RerankingServiceRecord,
	RerankingServiceRecordSchema,
	type SearchHit,
	SearchHitSchema,
	type TestConnectionResult,
	TestConnectionResultSchema,
	type UpdateKnowledgeBaseInput,
	type UpdateKnowledgeFilterInput,
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

	listWorkspaces: (): Promise<Workspace[]> =>
		request("/workspaces", { method: "GET" }, WorkspacePageSchema).then(
			(page) => page.items,
		),

	getWorkspace: (uid: string): Promise<Workspace> =>
		request(`/workspaces/${uid}`, { method: "GET" }, WorkspaceRecordSchema),

	createWorkspace: (input: CreateWorkspaceInput): Promise<Workspace> =>
		request(
			"/workspaces",
			{ method: "POST", body: JSON.stringify(normalizeCreate(input)) },
			WorkspaceRecordSchema,
		),

	updateWorkspace: (
		uid: string,
		patch: UpdateWorkspaceInput,
	): Promise<Workspace> =>
		request(
			`/workspaces/${uid}`,
			{ method: "PATCH", body: JSON.stringify(normalizeUpdate(patch)) },
			WorkspaceRecordSchema,
		),

	deleteWorkspace: (uid: string): Promise<void> =>
		request(`/workspaces/${uid}`, { method: "DELETE" }, null),

	testConnection: (uid: string): Promise<TestConnectionResult> =>
		request(
			`/workspaces/${uid}/test-connection`,
			{ method: "POST" },
			TestConnectionResultSchema,
		),

	listApiKeys: (workspaceUid: string): Promise<ApiKeyRecord[]> =>
		request(
			`/workspaces/${workspaceUid}/api-keys`,
			{ method: "GET" },
			ApiKeyPageSchema,
		).then((page) => page.items),

	createApiKey: (
		workspaceUid: string,
		input: CreateApiKeyInput,
	): Promise<CreatedApiKeyResponse> =>
		request(
			`/workspaces/${workspaceUid}/api-keys`,
			{
				method: "POST",
				body: JSON.stringify({
					label: input.label.trim(),
					expiresAt: input.expiresAt ?? null,
				}),
			},
			CreatedApiKeyResponseSchema,
		),

	revokeApiKey: (workspaceUid: string, keyId: string): Promise<void> =>
		request(
			`/workspaces/${workspaceUid}/api-keys/${keyId}`,
			{ method: "DELETE" },
			null,
		),

	/* -------- Knowledge bases -------- */

	listKnowledgeBases: (workspaceUid: string): Promise<KnowledgeBaseRecord[]> =>
		request(
			`/workspaces/${workspaceUid}/knowledge-bases`,
			{ method: "GET" },
			KnowledgeBasePageSchema,
		).then((page) => page.items),

	getKnowledgeBase: (
		workspaceUid: string,
		kbUid: string,
	): Promise<KnowledgeBaseRecord> =>
		request(
			`/workspaces/${workspaceUid}/knowledge-bases/${kbUid}`,
			{ method: "GET" },
			KnowledgeBaseRecordSchema,
		),

	createKnowledgeBase: (
		workspaceUid: string,
		input: CreateKnowledgeBaseInput,
	): Promise<KnowledgeBaseRecord> =>
		request(
			`/workspaces/${workspaceUid}/knowledge-bases`,
			{
				method: "POST",
				body: JSON.stringify({
					name: input.name,
					description: input.description ? input.description : null,
					embeddingServiceId: input.embeddingServiceId,
					chunkingServiceId: input.chunkingServiceId,
					rerankingServiceId: input.rerankingServiceId ?? null,
					language: input.language ? input.language : null,
				}),
			},
			KnowledgeBaseRecordSchema,
		),

	updateKnowledgeBase: (
		workspaceUid: string,
		kbUid: string,
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
			`/workspaces/${workspaceUid}/knowledge-bases/${kbUid}`,
			{ method: "PATCH", body: JSON.stringify(body) },
			KnowledgeBaseRecordSchema,
		);
	},

	deleteKnowledgeBase: (workspaceUid: string, kbUid: string): Promise<void> =>
		request(
			`/workspaces/${workspaceUid}/knowledge-bases/${kbUid}`,
			{ method: "DELETE" },
			null,
		),

	listKnowledgeFilters: (
		workspaceUid: string,
		kbUid: string,
	): Promise<KnowledgeFilterRecord[]> =>
		request(
			`/workspaces/${workspaceUid}/knowledge-bases/${kbUid}/filters`,
			{ method: "GET" },
			KnowledgeFilterPageSchema,
		).then((page) => page.items),

	getKnowledgeFilter: (
		workspaceUid: string,
		kbUid: string,
		filterUid: string,
	): Promise<KnowledgeFilterRecord> =>
		request(
			`/workspaces/${workspaceUid}/knowledge-bases/${kbUid}/filters/${filterUid}`,
			{ method: "GET" },
			KnowledgeFilterRecordSchema,
		),

	createKnowledgeFilter: (
		workspaceUid: string,
		kbUid: string,
		input: CreateKnowledgeFilterInput,
	): Promise<KnowledgeFilterRecord> =>
		request(
			`/workspaces/${workspaceUid}/knowledge-bases/${kbUid}/filters`,
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
		workspaceUid: string,
		kbUid: string,
		filterUid: string,
		patch: UpdateKnowledgeFilterInput,
	): Promise<KnowledgeFilterRecord> => {
		const body: Record<string, unknown> = {};
		if (patch.name !== undefined) body.name = patch.name;
		if (patch.description !== undefined)
			body.description = patch.description ? patch.description : null;
		if (patch.filter !== undefined) body.filter = patch.filter;
		return request(
			`/workspaces/${workspaceUid}/knowledge-bases/${kbUid}/filters/${filterUid}`,
			{ method: "PATCH", body: JSON.stringify(body) },
			KnowledgeFilterRecordSchema,
		);
	},

	deleteKnowledgeFilter: (
		workspaceUid: string,
		kbUid: string,
		filterUid: string,
	): Promise<void> =>
		request(
			`/workspaces/${workspaceUid}/knowledge-bases/${kbUid}/filters/${filterUid}`,
			{ method: "DELETE" },
			null,
		),

	/* -------- Execution services -------- */

	listChunkingServices: (
		workspaceUid: string,
	): Promise<ChunkingServiceRecord[]> =>
		request(
			`/workspaces/${workspaceUid}/chunking-services`,
			{ method: "GET" },
			ChunkingServicePageSchema,
		).then((page) => page.items),

	createChunkingService: (
		workspaceUid: string,
		input: CreateChunkingServiceInput,
	): Promise<ChunkingServiceRecord> =>
		request(
			`/workspaces/${workspaceUid}/chunking-services`,
			{ method: "POST", body: JSON.stringify(stripEmptyStrings(input)) },
			ChunkingServiceRecordSchema,
		),

	deleteChunkingService: (workspaceUid: string, uid: string): Promise<void> =>
		request(
			`/workspaces/${workspaceUid}/chunking-services/${uid}`,
			{ method: "DELETE" },
			null,
		),

	listEmbeddingServices: (
		workspaceUid: string,
	): Promise<EmbeddingServiceRecord[]> =>
		request(
			`/workspaces/${workspaceUid}/embedding-services`,
			{ method: "GET" },
			EmbeddingServicePageSchema,
		).then((page) => page.items),

	createEmbeddingService: (
		workspaceUid: string,
		input: CreateEmbeddingServiceInput,
	): Promise<EmbeddingServiceRecord> =>
		request(
			`/workspaces/${workspaceUid}/embedding-services`,
			{ method: "POST", body: JSON.stringify(stripEmptyStrings(input)) },
			EmbeddingServiceRecordSchema,
		),

	deleteEmbeddingService: (workspaceUid: string, uid: string): Promise<void> =>
		request(
			`/workspaces/${workspaceUid}/embedding-services/${uid}`,
			{ method: "DELETE" },
			null,
		),

	listRerankingServices: (
		workspaceUid: string,
	): Promise<RerankingServiceRecord[]> =>
		request(
			`/workspaces/${workspaceUid}/reranking-services`,
			{ method: "GET" },
			RerankingServicePageSchema,
		).then((page) => page.items),

	createRerankingService: (
		workspaceUid: string,
		input: CreateRerankingServiceInput,
	): Promise<RerankingServiceRecord> =>
		request(
			`/workspaces/${workspaceUid}/reranking-services`,
			{ method: "POST", body: JSON.stringify(stripEmptyStrings(input)) },
			RerankingServiceRecordSchema,
		),

	deleteRerankingService: (workspaceUid: string, uid: string): Promise<void> =>
		request(
			`/workspaces/${workspaceUid}/reranking-services/${uid}`,
			{ method: "DELETE" },
			null,
		),

	/* -------- KB documents -------- */

	listKbDocuments: (
		workspaceUid: string,
		kbUid: string,
	): Promise<RagDocumentRecord[]> =>
		request(
			`/workspaces/${workspaceUid}/knowledge-bases/${kbUid}/documents`,
			{ method: "GET" },
			RagDocumentPageSchema,
		).then((page) => page.items),

	listKbDocumentChunks: (
		workspaceUid: string,
		kbUid: string,
		documentUid: string,
		opts?: { limit?: number },
	): Promise<DocumentChunk[]> => {
		const qs = opts?.limit ? `?limit=${opts.limit}` : "";
		return request(
			`/workspaces/${workspaceUid}/knowledge-bases/${kbUid}/documents/${documentUid}/chunks${qs}`,
			{ method: "GET" },
			z.array(DocumentChunkSchema),
		);
	},

	deleteKbDocument: (
		workspaceUid: string,
		kbUid: string,
		documentUid: string,
	): Promise<void> =>
		request(
			`/workspaces/${workspaceUid}/knowledge-bases/${kbUid}/documents/${documentUid}`,
			{ method: "DELETE" },
			null,
		),

	/* -------- KB data plane -------- */

	kbSearch: (
		workspaceUid: string,
		kbUid: string,
		input: PlaygroundSearchInput,
	): Promise<SearchHit[]> =>
		request(
			`/workspaces/${workspaceUid}/knowledge-bases/${kbUid}/search`,
			{ method: "POST", body: JSON.stringify(input) },
			z.array(SearchHitSchema),
		),

	/* -------- Ingest + jobs -------- */

	kbIngestAsync: (
		workspaceUid: string,
		kbUid: string,
		input: KbIngestRequest,
	): Promise<KbAsyncIngestResponse> =>
		request(
			`/workspaces/${workspaceUid}/knowledge-bases/${kbUid}/ingest?async=true`,
			{ method: "POST", body: JSON.stringify(input) },
			KbAsyncIngestResponseSchema,
		),

	getJob: (workspaceUid: string, jobId: string): Promise<JobRecord> =>
		request(
			`/workspaces/${workspaceUid}/jobs/${jobId}`,
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
