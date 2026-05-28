/**
 * `/api/v1/workspaces/{workspaceId}/llm-services` — LLM service CRUD.
 *
 * LLM services describe **how** to call a chat / generation model —
 * provider, model name, endpoint, auth — and are referenced by agents
 * via `agent.llmServiceId`. Multiple agents in the same workspace
 * may share one service definition. Deleting an in-use service is
 * blocked with 409 (mirrors the embedding/chunking pattern).
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
	type ChatModelProbe,
	probeHuggingFaceChatModel,
} from "../../chat/model-probe.js";
import type { ChatConfig } from "../../config/schema.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import { ApiError } from "../../lib/errors.js";
import { errorResponse, makeOpenApi } from "../../lib/openapi.js";
import { paginate } from "../../lib/pagination.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CreateLlmServiceInputSchema,
	LlmServiceIdParamSchema,
	LlmServicePageSchema,
	LlmServiceRecordSchema,
	PaginationQuerySchema,
	UpdateLlmServiceInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import type { SecretResolver } from "../../secrets/provider.js";
import { toWireLlm, toWirePage } from "./serdes/index.js";

export interface LlmServiceRoutesDeps {
	readonly store: ControlPlaneStore;
	/**
	 * Resolves the model's credential for the config-time chat-model
	 * probe. When omitted (or when no credential resolves) the route is
	 * pure CRUD — probing is skipped, never fatal.
	 */
	readonly secrets?: SecretResolver;
	/**
	 * Runtime chat config. Supplies the fallback `tokenRef` used to
	 * probe a HuggingFace model that has no per-service `credentialRef`.
	 * `null` (no chat block / chat disabled) disables the fallback.
	 */
	readonly chatConfig?: ChatConfig | null;
	/** Probe implementation; defaults to the live HF probe. */
	readonly probeChatModel?: ChatModelProbe;
}

export function llmServiceRoutes(
	deps: LlmServiceRoutesDeps,
): OpenAPIHono<AppEnv> {
	const { store } = deps;
	const probe = deps.probeChatModel ?? probeHuggingFaceChatModel;
	const app = makeOpenApi();

	/**
	 * Config-time guard: for HuggingFace services, verify the model is
	 * usable for chat before persisting. Skips silently when we can't
	 * resolve a token to probe with (no secrets resolver, no per-service
	 * credentialRef and no chat fallback, or an unresolved ref) — the
	 * runtime degrades to the pre-existing send-time error in that case
	 * rather than blocking the save. Rejects with 422 only on a
	 * definitive signal: `llm_model_not_chat` (served but not for chat)
	 * or `llm_model_unavailable` (no provider serves it).
	 */
	async function assertChatModelOrSkip(input: {
		readonly provider: string;
		readonly modelName: string;
		readonly credentialRef: string | null | undefined;
	}): Promise<void> {
		if (input.provider !== "huggingface") return;
		if (!deps.secrets) return;
		const ref = input.credentialRef ?? deps.chatConfig?.tokenRef ?? null;
		if (!ref) return;
		let token: string;
		try {
			token = await deps.secrets.resolve(ref);
		} catch {
			return; // unresolved credential → can't probe → fail-open
		}
		if (!token) return;
		const outcome = await probe({ modelName: input.modelName, token });
		if (outcome.kind === "rejected") {
			const lead =
				outcome.code === "llm_model_not_chat"
					? `HuggingFace model "${input.modelName}" is not served for the chat-completion task; pick a conversational/instruct model (e.g. openai/gpt-oss-20b).`
					: `HuggingFace model "${input.modelName}" is not served by any Inference provider on your account; enable a provider at huggingface.co/settings/inference-providers or pick a widely-served model (e.g. openai/gpt-oss-20b).`;
			throw new ApiError(
				outcome.code,
				`${lead} Provider detail: ${outcome.detail}`,
			);
		}
	}

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/llm-services",
			tags: ["llm-services"],
			summary: "List LLM services in a workspace",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				query: PaginationQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: LlmServicePageSchema },
					},
					description: "All LLM services in the workspace",
				},
				...errorResponse(404, "Workspace not found"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const query = c.req.valid("query");
			const rows = await store.listLlmServices(workspaceId);
			return c.json(toWirePage(paginate(rows, query), toWireLlm), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/llm-services",
			tags: ["llm-services"],
			summary: "Create an LLM service",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				body: {
					content: {
						"application/json": { schema: CreateLlmServiceInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: {
						"application/json": { schema: LlmServiceRecordSchema },
					},
					description: "Created",
				},
				...errorResponse(404, "Workspace not found"),
				...errorResponse(409, "Duplicate llmServiceId"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const body = c.req.valid("json");
			await assertChatModelOrSkip({
				provider: body.provider,
				modelName: body.modelName,
				credentialRef: body.credentialRef,
			});
			const record = await store.createLlmService(workspaceId, {
				...body,
				uid: body.llmServiceId,
			});
			return c.json(toWireLlm(record), 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/llm-services/{llmServiceId}",
			tags: ["llm-services"],
			summary: "Get an LLM service",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					llmServiceId: LlmServiceIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: LlmServiceRecordSchema },
					},
					description: "LLM service",
				},
				...errorResponse(404, "Workspace or service not found"),
			},
		}),
		async (c) => {
			const { workspaceId, llmServiceId } = c.req.valid("param");
			const record = await store.getLlmService(workspaceId, llmServiceId);
			if (!record)
				throw new ControlPlaneNotFoundError("llm service", llmServiceId);
			return c.json(toWireLlm(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "patch",
			path: "/{workspaceId}/llm-services/{llmServiceId}",
			tags: ["llm-services"],
			summary: "Update an LLM service",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					llmServiceId: LlmServiceIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateLlmServiceInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: LlmServiceRecordSchema },
					},
					description: "Updated",
				},
				...errorResponse(404, "Workspace or service not found"),
			},
		}),
		async (c) => {
			const { workspaceId, llmServiceId } = c.req.valid("param");
			const body = c.req.valid("json");
			// Re-probe only when the update touches the provider, model, or
			// credential — otherwise the effective model is unchanged.
			if (
				body.provider !== undefined ||
				body.modelName !== undefined ||
				body.credentialRef !== undefined
			) {
				const existing = await store.getLlmService(workspaceId, llmServiceId);
				if (existing) {
					await assertChatModelOrSkip({
						provider: body.provider ?? existing.provider,
						modelName: body.modelName ?? existing.modelName,
						credentialRef: body.credentialRef ?? existing.credentialRef,
					});
				}
			}
			const record = await store.updateLlmService(
				workspaceId,
				llmServiceId,
				body,
			);
			return c.json(toWireLlm(record), 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/llm-services/{llmServiceId}",
			tags: ["llm-services"],
			summary: "Delete an LLM service",
			description:
				"Refuses with 409 if any agent in the workspace still references this service via `agent.llmServiceId`.",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					llmServiceId: LlmServiceIdParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				...errorResponse(404, "Workspace or service not found"),
				...errorResponse(409, "Service is still referenced by an agent"),
			},
		}),
		async (c) => {
			const { workspaceId, llmServiceId } = c.req.valid("param");
			const { deleted } = await store.deleteLlmService(
				workspaceId,
				llmServiceId,
			);
			if (!deleted)
				throw new ControlPlaneNotFoundError("llm service", llmServiceId);
			return c.body(null, 204);
		},
	);

	return app;
}
