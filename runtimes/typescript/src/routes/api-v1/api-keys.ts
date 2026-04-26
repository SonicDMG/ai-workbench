/**
 * `/api/v1/workspaces/{workspaceUid}/api-keys` — workspace-scoped
 * API-key issuance, listing, and revocation.
 *
 * Invariants enforced here (and verified by conformance):
 *   - The plaintext token is returned exactly once, from `POST`.
 *     Every other endpoint sees only the record (`prefix`,
 *     `label`, timestamps). The `hash` column never crosses the
 *     API boundary.
 *   - `DELETE` is a soft revoke: sets `revokedAt`, leaves the row
 *     in the list (so audit tools and operators can still see the
 *     history). Re-revoke is a no-op.
 *
 * Route-level auth (who can call these) is the middleware's job —
 * see docs/auth.md. RBAC enforcement lands in the RBAC PR.
 */

import { randomUUID } from "node:crypto";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { mintToken } from "../../auth/apiKey/token.js";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import { makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	ApiKeyIdParamSchema,
	ApiKeyPageSchema,
	CreateApiKeyInputSchema,
	CreatedApiKeyResponseSchema,
	ErrorEnvelopeSchema,
	PaginationQuerySchema,
	WorkspaceUidParamSchema,
} from "../../openapi/schemas.js";

export function apiKeyRoutes(store: ControlPlaneStore): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceUid}/api-keys",
			tags: ["api-keys"],
			summary: "List API keys scoped to a workspace",
			description:
				"Returns every key ever issued for the workspace, including revoked ones (revokedAt is non-null). The `hash` is never exposed; only `prefix`, `label`, and timestamps.",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: ApiKeyPageSchema },
					},
					description: "All API keys in the workspace",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid } = c.req.valid("param");
			const query = c.req.valid("query");
			assertWorkspaceAccess(c, workspaceUid);
			const rows = await store.listApiKeys(workspaceUid);
			const page = paginate(rows, query);
			return c.json(
				{ items: page.items.map(stripHash), nextCursor: page.nextCursor },
				200,
			);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceUid}/api-keys",
			tags: ["api-keys"],
			summary: "Issue a new API key",
			description:
				"Creates a new key and returns the plaintext **exactly once** on this response. The runtime stores only a scrypt digest; there is no way to recover the plaintext later. Copy it immediately.",
			request: {
				params: z.object({ workspaceUid: WorkspaceUidParamSchema }),
				body: {
					content: {
						"application/json": { schema: CreateApiKeyInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: {
						"application/json": { schema: CreatedApiKeyResponseSchema },
					},
					description:
						"Key created. `plaintext` is shown once and never retrievable again.",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const body = c.req.valid("json");
			const keyId = randomUUID();
			const minted = await mintToken();
			const record = await store.persistApiKey(workspaceUid, {
				keyId,
				prefix: minted.prefix,
				hash: minted.hash,
				label: body.label,
				expiresAt: body.expiresAt ?? null,
			});
			return c.json(
				{ plaintext: minted.plaintext, key: stripHash(record) },
				201,
			);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceUid}/api-keys/{keyId}",
			tags: ["api-keys"],
			summary: "Revoke an API key",
			description:
				"Soft-revoke: sets `revokedAt` and leaves the row visible in `GET /api-keys`. The key stops authenticating immediately — the next request bearing it gets `401 unauthorized`. Re-revoking an already-revoked key is a no-op (returns 204).",
			request: {
				params: z.object({
					workspaceUid: WorkspaceUidParamSchema,
					keyId: ApiKeyIdParamSchema,
				}),
			},
			responses: {
				204: { description: "Revoked (or was already revoked)" },
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or key not found",
				},
			},
		}),
		async (c) => {
			const { workspaceUid, keyId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceUid);
			const existing = await store.getApiKey(workspaceUid, keyId);
			if (!existing) {
				throw new ControlPlaneNotFoundError("api_key", keyId);
			}
			await store.revokeApiKey(workspaceUid, keyId);
			return c.body(null, 204);
		},
	);

	return app;
}

/** Remove the `hash` column before serving a record. */
function stripHash<T extends { readonly hash: string }>(
	rec: T,
): Omit<T, "hash"> {
	const { hash: _hash, ...rest } = rec;
	return rest;
}
