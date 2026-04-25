import { z } from "zod";
import { getAuthToken } from "./authToken";
import {
	type ApiKeyRecord,
	ApiKeyRecordSchema,
	type AsyncIngestResponse,
	AsyncIngestResponseSchema,
	type CatalogRecord,
	CatalogRecordSchema,
	type CreateApiKeyInput,
	type CreateCatalogInput,
	type CreatedApiKeyResponse,
	CreatedApiKeyResponseSchema,
	type CreateSavedQueryInput,
	type CreateVectorStoreInput,
	type CreateWorkspaceInput,
	type DocumentRecord,
	DocumentRecordSchema,
	ErrorEnvelopeSchema,
	type IngestRequest,
	type JobRecord,
	JobRecordSchema,
	type SavedQueryRecord,
	SavedQueryRecordSchema,
	type SearchHit,
	SearchHitSchema,
	type TestConnectionResult,
	TestConnectionResultSchema,
	type UpdateWorkspaceInput,
	type VectorStoreRecord,
	VectorStoreRecordSchema,
	type Workspace,
	WorkspaceRecordSchema,
} from "./schemas";
import { fetchAuthConfig, loginHref } from "./session";

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

/**
 * Render any caught value into a single human-readable line for a
 * toast description or inline error banner. Centralizes the
 * `ApiError ? "code: message" : Error ? message : "Unknown error"`
 * shape that was duplicated across every dialog and mutation site.
 */
export function formatApiError(err: unknown): string {
	if (err instanceof ApiError) return `${err.code}: ${err.message}`;
	if (err instanceof Error) return err.message;
	return "Unknown error";
}

async function request<T>(
	path: string,
	init: RequestInit,
	responseSchema: z.ZodType<T> | null,
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
		// Session expired (or never existed) and no paste-token is
		// active. If OIDC login is available the user should go there
		// instead of seeing a cryptic "unauthorized" in a toast.
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

const WorkspaceListSchema = z.array(WorkspaceRecordSchema);

// Cache the auth config look-up so a wall of 401s doesn't fire off
// a /auth/config request for every one. Only the first 401 in a
// page lifetime triggers a redirect; subsequent ones just throw
// normally and surface in whatever UI is calling.
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
		// leave the caller's ApiError(401) to surface normally
	} finally {
		redirecting = false;
	}
}

export const api = {
	listWorkspaces: (): Promise<Workspace[]> =>
		request("/workspaces", { method: "GET" }, WorkspaceListSchema),

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
			{ method: "PUT", body: JSON.stringify(normalizeUpdate(patch)) },
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

	listApiKeys: (workspace: string): Promise<ApiKeyRecord[]> =>
		request(
			`/workspaces/${workspace}/api-keys`,
			{ method: "GET" },
			z.array(ApiKeyRecordSchema),
		),

	createApiKey: (
		workspace: string,
		input: CreateApiKeyInput,
	): Promise<CreatedApiKeyResponse> =>
		request(
			`/workspaces/${workspace}/api-keys`,
			{
				method: "POST",
				body: JSON.stringify({
					label: input.label.trim(),
					expiresAt: input.expiresAt ?? null,
				}),
			},
			CreatedApiKeyResponseSchema,
		),

	revokeApiKey: (workspace: string, keyId: string): Promise<void> =>
		request(
			`/workspaces/${workspace}/api-keys/${keyId}`,
			{ method: "DELETE" },
			null,
		),

	listVectorStores: (workspace: string): Promise<VectorStoreRecord[]> =>
		request(
			`/workspaces/${workspace}/vector-stores`,
			{ method: "GET" },
			z.array(VectorStoreRecordSchema),
		),

	createVectorStore: (
		workspace: string,
		input: CreateVectorStoreInput,
	): Promise<VectorStoreRecord> =>
		request(
			`/workspaces/${workspace}/vector-stores`,
			{ method: "POST", body: JSON.stringify(input) },
			VectorStoreRecordSchema,
		),

	deleteVectorStore: (workspace: string, uid: string): Promise<void> =>
		request(
			`/workspaces/${workspace}/vector-stores/${uid}`,
			{ method: "DELETE" },
			null,
		),

	search: (
		workspace: string,
		vectorStore: string,
		input: PlaygroundSearchInput,
	): Promise<SearchHit[]> =>
		request(
			`/workspaces/${workspace}/vector-stores/${vectorStore}/search`,
			{ method: "POST", body: JSON.stringify(input) },
			z.array(SearchHitSchema),
		),

	/* -------- Catalogs -------- */

	listCatalogs: (workspace: string): Promise<CatalogRecord[]> =>
		request(
			`/workspaces/${workspace}/catalogs`,
			{ method: "GET" },
			z.array(CatalogRecordSchema),
		),

	createCatalog: (
		workspace: string,
		input: CreateCatalogInput,
	): Promise<CatalogRecord> =>
		request(
			`/workspaces/${workspace}/catalogs`,
			{
				method: "POST",
				body: JSON.stringify({
					name: input.name,
					description: input.description ? input.description : null,
					vectorStore: input.vectorStore ?? null,
				}),
			},
			CatalogRecordSchema,
		),

	deleteCatalog: (workspace: string, catalogId: string): Promise<void> =>
		request(
			`/workspaces/${workspace}/catalogs/${catalogId}`,
			{ method: "DELETE" },
			null,
		),

	/* -------- Documents -------- */

	listDocuments: (
		workspace: string,
		catalogId: string,
	): Promise<DocumentRecord[]> =>
		request(
			`/workspaces/${workspace}/catalogs/${catalogId}/documents`,
			{ method: "GET" },
			z.array(DocumentRecordSchema),
		),

	/* -------- Ingest + jobs -------- */

	/**
	 * Async ingest. The response comes back immediately with a job +
	 * document pointer; the pipeline runs in the background and the
	 * caller polls {@link api.getJob} for progress.
	 */
	ingestAsync: (
		workspace: string,
		catalogId: string,
		input: IngestRequest,
	): Promise<AsyncIngestResponse> =>
		request(
			`/workspaces/${workspace}/catalogs/${catalogId}/ingest?async=true`,
			{ method: "POST", body: JSON.stringify(input) },
			AsyncIngestResponseSchema,
		),

	getJob: (workspace: string, jobId: string): Promise<JobRecord> =>
		request(
			`/workspaces/${workspace}/jobs/${jobId}`,
			{ method: "GET" },
			JobRecordSchema,
		),

	/* -------- Saved queries -------- */

	listSavedQueries: (
		workspace: string,
		catalogId: string,
	): Promise<SavedQueryRecord[]> =>
		request(
			`/workspaces/${workspace}/catalogs/${catalogId}/queries`,
			{ method: "GET" },
			z.array(SavedQueryRecordSchema),
		),

	createSavedQuery: (
		workspace: string,
		catalogId: string,
		input: CreateSavedQueryInput,
	): Promise<SavedQueryRecord> =>
		request(
			`/workspaces/${workspace}/catalogs/${catalogId}/queries`,
			{
				method: "POST",
				body: JSON.stringify({
					name: input.name,
					description: input.description ? input.description : null,
					text: input.text,
					topK: input.topK ?? null,
					filter: input.filter ?? null,
				}),
			},
			SavedQueryRecordSchema,
		),

	deleteSavedQuery: (
		workspace: string,
		catalogId: string,
		queryId: string,
	): Promise<void> =>
		request(
			`/workspaces/${workspace}/catalogs/${catalogId}/queries/${queryId}`,
			{ method: "DELETE" },
			null,
		),

	runSavedQuery: (
		workspace: string,
		catalogId: string,
		queryId: string,
	): Promise<SearchHit[]> =>
		request(
			`/workspaces/${workspace}/catalogs/${catalogId}/queries/${queryId}/run`,
			{ method: "POST" },
			z.array(SearchHitSchema),
		),
};

export interface PlaygroundSearchInput {
	readonly text?: string;
	readonly vector?: number[];
	readonly topK?: number;
	readonly filter?: Record<string, unknown>;
	readonly includeEmbeddings?: boolean;
	/** Opt into the hybrid (vector + lexical) lane. Requires `text`. */
	readonly hybrid?: boolean;
	/** Weight of the lexical score in the hybrid combination (0..1). */
	readonly lexicalWeight?: number;
	/** Opt into driver-side reranking after retrieval. Requires `text`. */
	readonly rerank?: boolean;
}

// Normalize form empties to match the backend's nullable contract: empty
// strings → null so the server doesn't see "". credentialsRef keys with
// empty names get dropped.
function normalizeCreate(input: CreateWorkspaceInput) {
	return {
		name: input.name,
		kind: input.kind,
		endpoint: input.endpoint ? input.endpoint : null,
		keyspace: input.keyspace ? input.keyspace : null,
		credentialsRef: pruneCredentials(input.credentialsRef),
	};
}

function normalizeUpdate(patch: UpdateWorkspaceInput) {
	const out: Record<string, unknown> = {};
	if (patch.name !== undefined) out.name = patch.name;
	if (patch.endpoint !== undefined)
		out.endpoint = patch.endpoint ? patch.endpoint : null;
	if (patch.keyspace !== undefined)
		out.keyspace = patch.keyspace ? patch.keyspace : null;
	if (patch.credentialsRef !== undefined)
		out.credentialsRef = pruneCredentials(patch.credentialsRef);
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
