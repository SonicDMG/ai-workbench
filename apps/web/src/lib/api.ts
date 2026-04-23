import { z } from "zod";
import { getAuthToken } from "./authToken";
import {
	type ApiKeyRecord,
	ApiKeyRecordSchema,
	type CreateApiKeyInput,
	type CreatedApiKeyResponse,
	CreatedApiKeyResponseSchema,
	type CreateWorkspaceInput,
	ErrorEnvelopeSchema,
	type TestConnectionResult,
	TestConnectionResultSchema,
	type UpdateWorkspaceInput,
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
};

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
