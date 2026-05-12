/**
 * `/api/v1/workspaces/{workspaceId}/connect/*` — the workspace
 * **Connect** surface. Renders per-framework recipes ("how do I plug
 * this workspace into LangGraph / CrewAI / Google ADK / Microsoft
 * Agent Framework / IBM watsonx Agent Builder?") so the customer can
 * copy-paste a working snippet without leaving the product.
 *
 * Design notes:
 *   - **Pure read.** No control-plane mutations; safe to call from a
 *     public landing-page demo. Auth is the same workspace-scoped
 *     middleware as every other `/api/v1/*` route.
 *   - **No secrets in the response.** The rendered code references
 *     the API key by env-var name (`WORKBENCH_API_KEY` by default,
 *     overridable via `?apiKeyEnvVar=`) so a screenshare of the
 *     Connect tab never leaks a token.
 *   - **Stateless / cache-friendly.** The body is a pure function of
 *     `(workspaceId, knowledgeBaseId, publicBaseUrl, apiKeyEnvVar,
 *     mcp.enabled)`; the route stamps a short `Cache-Control` so the
 *     UI can re-render without re-rendering server-side.
 *
 * See `docs/integrations/` for the same snippets rendered as static
 * documentation, kept in lockstep with this generator by the
 * conformance harness.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { McpConfig } from "../../config/schema.js";
import { buildAllSnippets } from "../../connect/snippets/index.js";
import {
	mcpUrl as buildMcpUrl,
	restBaseUrl as buildRestBaseUrl,
} from "../../connect/snippets/urls.js";
import type { SnippetContext } from "../../connect/types.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import { ApiError } from "../../lib/errors.js";
import { errorResponse, makeOpenApi } from "../../lib/openapi.js";
import { resolvePublicBaseUrl } from "../../lib/public-url.js";
import type { AppEnv } from "../../lib/types.js";
import {
	ConnectSnippetsQuerySchema,
	ConnectSnippetsResponseSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";

export interface ConnectRouteDeps {
	readonly store: ControlPlaneStore;
	readonly mcpConfig: McpConfig;
}

const DEFAULT_API_KEY_ENV_VAR = "WORKBENCH_API_KEY";

export function connectRoutes(deps: ConnectRouteDeps): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/connect/snippets",
			tags: ["connect"],
			summary: "Render per-framework integration recipes",
			description:
				"Returns a copy-pasteable snippet per supported agent framework (LangGraph, CrewAI, Google ADK, Microsoft Agent Framework, IBM watsonx Agent Builder, plus a raw curl smoke test). Pure read; no secrets are ever embedded in the rendered code — snippets read the API key from the env var named by `apiKeyEnvVar`.",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				query: ConnectSnippetsQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: ConnectSnippetsResponseSchema },
					},
					description:
						"Rendered snippets plus the resolved endpoint URLs for the workspace.",
				},
				...errorResponse(404, "Workspace not found"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const query = c.req.valid("query");

			const workspace = await deps.store.getWorkspace(workspaceId);
			if (!workspace) {
				throw new ApiError(
					"workspace_not_found",
					`workspace '${workspaceId}' not found`,
					404,
				);
			}

			const publicBaseUrl = resolvePublicBaseUrl(c.req.raw);
			const apiKeyEnvVar = query.apiKeyEnvVar ?? DEFAULT_API_KEY_ENV_VAR;
			const knowledgeBaseId = query.knowledgeBaseId ?? null;
			const ctx: SnippetContext = {
				workspaceId,
				knowledgeBaseId,
				publicBaseUrl,
				mcpEnabled: deps.mcpConfig.enabled,
				apiKeyEnvVar,
			};

			const targets = buildAllSnippets(ctx);

			// Short private cache: the body is a pure function of inputs,
			// but the API-key state can change (rotations, revocations)
			// independently and the user does not need stale snippets in a
			// CDN. 60s is enough to make a fast tab-switch feel instant.
			c.header("Cache-Control", "private, max-age=60");

			return c.json(
				{
					workspaceId,
					knowledgeBaseId,
					publicBaseUrl,
					mcpUrl: buildMcpUrl(publicBaseUrl, workspaceId),
					restBaseUrl: buildRestBaseUrl(publicBaseUrl),
					mcpEnabled: deps.mcpConfig.enabled,
					apiKeyEnvVar,
					// Spread so the wire-type's `targets: ConnectSnippet[]`
					// gets a mutable array — `buildAllSnippets` returns a
					// `readonly` slice that Zod's inferred shape doesn't
					// accept.
					targets: [...targets],
				},
				200,
			);
		},
	);

	return app;
}
