/**
 * Default route-plugin registry — wraps every in-tree workspace-
 * scoped route module as a {@link RoutePlugin} so `app.ts` can mount
 * them through one iteration instead of 13 hand-wired `app.route(...)`
 * calls.
 *
 * Adding a new workspace-scoped route should now mean:
 *   1. Write the route module (still using `OpenAPIHono` directly).
 *   2. Append one entry here.
 *
 * Tests can build their own `RoutePluginRegistry` if they want to
 * exercise a subset of routes; production wiring goes through
 * `buildDefaultRoutePlugins(ctx)`.
 *
 * MCP is plugged in alongside the rest. It is gated at request time by
 * `ctx.mcpConfig.enabled` (returns 404 when off) so the surface isn't
 * probeable from the wire when disabled.
 */

import { agentRoutes } from "../routes/api-v1/agents.js";
import { apiKeyRoutes } from "../routes/api-v1/api-keys.js";
import { chunkingServiceRoutes } from "../routes/api-v1/chunking-services.js";
import { connectRoutes } from "../routes/api-v1/connect.js";
import { embeddingServiceRoutes } from "../routes/api-v1/embedding-services.js";
import { jobRoutes } from "../routes/api-v1/jobs.js";
import { kbDataPlaneRoutes } from "../routes/api-v1/kb-data-plane.js";
import { kbDocumentRoutes } from "../routes/api-v1/kb-documents.js";
import { knowledgeBaseRoutes } from "../routes/api-v1/knowledge-bases.js";
import { knowledgeFilterRoutes } from "../routes/api-v1/knowledge-filters.js";
import { llmServiceRoutes } from "../routes/api-v1/llm-services.js";
import { mcpRoutes } from "../routes/api-v1/mcp.js";
import { playgroundRoutes } from "../routes/api-v1/playground.js";
import { policyRoutes } from "../routes/api-v1/policy.js";
import { principalRoutes } from "../routes/api-v1/principals.js";
import { rerankingServiceRoutes } from "../routes/api-v1/reranking-services.js";
import { workspaceRoutes } from "../routes/api-v1/workspaces.js";
import { createIngestService } from "../services/ingest-service.js";
import { RoutePluginRegistry } from "./registry.js";
import type { RoutePlugin, RoutePluginContext } from "./types.js";

const WORKSPACE_MOUNT = "/api/v1/workspaces";

/**
 * Construct the default registry of workspace-scoped route plugins.
 * Order is significant for overlapping routes — Hono uses
 * first-write-wins — but every route here is on a unique sub-path so
 * the order is informational only (matches the historical mount order
 * in `app.ts`).
 */
export function buildDefaultRoutePlugins(
	ctx: RoutePluginContext,
): RoutePluginRegistry {
	const registry = new RoutePluginRegistry();
	for (const plugin of defaultPluginList(ctx)) {
		registry.register(plugin);
	}
	return registry;
}

function defaultPluginList(ctx: RoutePluginContext): readonly RoutePlugin[] {
	// Single `IngestService` instance shared between the MCP plugin
	// (powers `ingest_text` / `delete_document`) and the Connect
	// plugin (powers the **Verify** smoke test, which spins up an
	// in-process MCP server using the same registration code). The
	// service is stateless above the underlying store / drivers /
	// jobs / semaphore — sharing avoids two confusingly-identical
	// instances in production.
	const ingestService = createIngestService({
		store: ctx.store,
		drivers: ctx.drivers,
		embedders: ctx.embedders,
		jobs: ctx.jobs,
		replicaId: ctx.replicaId,
		ingestSemaphore: ctx.ingestSemaphore,
	});
	return [
		{
			id: "workspaces",
			mountPath: WORKSPACE_MOUNT,
			build: () =>
				workspaceRoutes({
					store: ctx.store,
					secrets: ctx.secrets,
					drivers: ctx.drivers,
				}),
		},
		{
			id: "jobs",
			mountPath: WORKSPACE_MOUNT,
			build: () => jobRoutes({ jobs: ctx.jobs }),
		},
		{
			id: "api_keys",
			mountPath: WORKSPACE_MOUNT,
			build: () => apiKeyRoutes(ctx.store),
		},
		{
			id: "knowledge_bases",
			mountPath: WORKSPACE_MOUNT,
			build: () =>
				knowledgeBaseRoutes({ store: ctx.store, drivers: ctx.drivers }),
		},
		{
			id: "knowledge_filters",
			mountPath: WORKSPACE_MOUNT,
			build: () => knowledgeFilterRoutes(ctx.store),
		},
		{
			id: "agents",
			mountPath: WORKSPACE_MOUNT,
			build: () =>
				agentRoutes({
					store: ctx.store,
					drivers: ctx.drivers,
					embedders: ctx.embedders,
					secrets: ctx.secrets,
					chatService: ctx.chatService,
					chatConfig: ctx.chatConfig,
				}),
		},
		{
			id: "chunking_services",
			mountPath: WORKSPACE_MOUNT,
			build: () => chunkingServiceRoutes(ctx.store),
		},
		{
			id: "embedding_services",
			mountPath: WORKSPACE_MOUNT,
			build: () => embeddingServiceRoutes(ctx.store),
		},
		{
			id: "reranking_services",
			mountPath: WORKSPACE_MOUNT,
			build: () => rerankingServiceRoutes(ctx.store),
		},
		{
			id: "llm_services",
			mountPath: WORKSPACE_MOUNT,
			build: () => llmServiceRoutes(ctx.store),
		},
		{
			id: "kb_data_plane",
			mountPath: WORKSPACE_MOUNT,
			build: () =>
				kbDataPlaneRoutes({
					store: ctx.store,
					drivers: ctx.drivers,
					embedders: ctx.embedders,
				}),
		},
		{
			id: "kb_documents",
			mountPath: WORKSPACE_MOUNT,
			build: () =>
				kbDocumentRoutes({
					store: ctx.store,
					drivers: ctx.drivers,
					embedders: ctx.embedders,
					jobs: ctx.jobs,
					replicaId: ctx.replicaId,
					ingestSemaphore: ctx.ingestSemaphore,
					extractors: ctx.extractors,
				}),
		},
		{
			id: "mcp",
			mountPath: WORKSPACE_MOUNT,
			build: () =>
				mcpRoutes({
					store: ctx.store,
					drivers: ctx.drivers,
					embedders: ctx.embedders,
					chatService: ctx.chatService,
					chatConfig: ctx.chatConfig,
					mcpConfig: ctx.mcpConfig,
					ingestService,
				}),
		},
		{
			id: "playground",
			mountPath: WORKSPACE_MOUNT,
			build: () =>
				playgroundRoutes({
					store: ctx.store,
					secrets: ctx.secrets,
				}),
		},
		{
			id: "connect",
			mountPath: WORKSPACE_MOUNT,
			build: () =>
				connectRoutes({
					store: ctx.store,
					mcpConfig: ctx.mcpConfig,
					drivers: ctx.drivers,
					embedders: ctx.embedders,
					chatService: ctx.chatService,
					chatConfig: ctx.chatConfig,
					ingestService,
				}),
		},
		// RLAC prototype: principal CRUD + policy compile-preview + audit.
		{
			id: "principals",
			mountPath: WORKSPACE_MOUNT,
			build: () => principalRoutes(ctx.store),
		},
		{
			id: "policy",
			mountPath: WORKSPACE_MOUNT,
			build: () => policyRoutes(ctx.store),
		},
	];
}
