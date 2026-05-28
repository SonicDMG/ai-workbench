/**
 * `GET /api/v1/llm-models` — selectable chat models for a provider.
 *
 * Non-workspace-scoped: the model catalog is a runtime-level fact, not
 * per-workspace. Backs the LLM-service form's model picker so the UI
 * doesn't carry a hardcoded, drifting list. Delegates to
 * {@link ../../chat/model-catalog.listChatModels}, which fetches the
 * provider's live catalog (OpenRouter `/models`, Ollama `/models`) and
 * falls back to a curated static list when the upstream is unreachable.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { listChatModels } from "../../chat/model-catalog.js";
import type { ChatConfig } from "../../config/schema.js";
import { makeOpenApi } from "../../lib/openapi.js";
import type { AppEnv } from "../../lib/types.js";
import {
	EndpointBaseUrlSchema,
	LlmModelListSchema,
} from "../../openapi/schemas.js";

export interface LlmModelsRoutesDeps {
	/** Supplies the default provider + the Ollama base URL when the
	 * caller doesn't pass them explicitly. */
	readonly chatConfig?: ChatConfig | null;
	/** Injected by tests to avoid real network. */
	readonly fetchImpl?: typeof fetch;
}

export function llmModelsRoutes(
	deps: LlmModelsRoutesDeps,
): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/llm-models",
			tags: ["llm-services"],
			summary: "List selectable chat models for a provider",
			description:
				"Returns tool-calling-capable models for the given provider (default: the runtime's configured chat provider). Falls back to a curated static list when the provider's catalog is unreachable (offline installs, outages).",
			request: {
				query: z.object({
					provider: z.enum(["openrouter", "openai", "ollama"]).optional(),
					// Validated through the same SSRF guard as service
					// endpoints: this route is not workspace-auth-scoped and
					// forwards `baseUrl` to an outbound fetch (Ollama catalog),
					// so a bare string would expose a metadata-endpoint pivot.
					baseUrl: EndpointBaseUrlSchema.optional(),
				}),
			},
			responses: {
				200: {
					content: { "application/json": { schema: LlmModelListSchema } },
					description: "Model catalog for the provider",
				},
			},
		}),
		async (c) => {
			const { provider, baseUrl } = c.req.valid("query");
			const resolvedProvider =
				provider ?? deps.chatConfig?.provider ?? "openrouter";
			// For Ollama, default the base URL to the runtime's configured
			// chat baseUrl so the picker queries the same local server chat
			// uses.
			const resolvedBaseUrl =
				baseUrl ??
				(resolvedProvider === "ollama" ? deps.chatConfig?.baseUrl : null);
			const list = await listChatModels({
				provider: resolvedProvider,
				baseUrl: resolvedBaseUrl,
				fetchImpl: deps.fetchImpl,
			});
			// Reshape the readonly catalog into the mutable wire shape the
			// generated OpenAPI response type expects.
			return c.json(
				{
					provider: list.provider,
					source: list.source,
					models: list.models.map((m) => ({
						id: m.id,
						name: m.name,
						supportsTools: m.supportsTools,
						recommended: m.recommended,
					})),
				},
				200,
			);
		},
	);

	return app;
}
