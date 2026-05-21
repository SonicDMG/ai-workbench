/**
 * Workspace-scoped playground for Astra Data API commands.
 *
 * This is intentionally a raw Data API command executor, not a
 * workbench KB/search abstraction. The UI builds a curated command
 * envelope, this route resolves the workspace's Astra credentials on
 * the server, and `astra-db-ts` sends the command to the configured
 * database/keyspace.
 */

import { DataAPIClient } from "@datastax/astra-db-ts";
import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import type { WorkspaceRecord } from "../../control-plane/types.js";
import { WorkspaceMisconfiguredError } from "../../drivers/vector-store.js";
import { RetryingAstraFetcher } from "../../lib/astra-retrying-fetcher.js";
import { ApiError } from "../../lib/errors.js";
import { errorResponse, makeOpenApi } from "../../lib/openapi.js";
import type { AppEnv } from "../../lib/types.js";
import { WorkspaceIdParamSchema } from "../../openapi/schemas.js";
import type { SecretResolver } from "../../secrets/provider.js";

const PlaygroundCommandNameSchema = z.enum([
	"findCollections",
	"createCollection",
	"deleteCollection",
	"listTables",
	"createTable",
	"dropTable",
	"createIndex",
	"createTextIndex",
	"createVectorIndex",
	"listIndexes",
	"dropIndex",
	"find",
	"findOne",
	"distinct",
	"insertOne",
	"insertMany",
	"updateOne",
	"updateMany",
	"deleteOne",
	"deleteMany",
	"countDocuments",
]);

const PlaygroundTargetKindSchema = z.enum(["collection", "table"]);
const JsonObjectSchema = z.record(z.string(), z.unknown());

const ExecutePlaygroundCommandInputSchema = z
	.object({
		commandName: PlaygroundCommandNameSchema,
		targetKind: PlaygroundTargetKindSchema.optional(),
		collection: z.string().min(1).max(128).nullable().optional(),
		table: z.string().min(1).max(128).nullable().optional(),
		command: JsonObjectSchema,
	})
	.openapi("ExecutePlaygroundCommandInput");

const ExecutePlaygroundCommandResponseSchema = z
	.object({
		ok: z.literal(true),
		commandName: PlaygroundCommandNameSchema,
		targetKind: PlaygroundTargetKindSchema,
		targetName: z.string().nullable(),
		collection: z.string().nullable(),
		table: z.string().nullable(),
		keyspace: z.string().nullable(),
		command: JsonObjectSchema,
		result: z.unknown(),
		elapsedMs: z.number().int().nonnegative(),
	})
	.openapi("ExecutePlaygroundCommandResponse");

const DB_COMMANDS = new Set([
	"findCollections",
	"createCollection",
	"deleteCollection",
	"listTables",
	"createTable",
	"dropTable",
]);

const TABLE_TARGET_COMMANDS = new Set([
	"createIndex",
	"createTextIndex",
	"createVectorIndex",
	"listIndexes",
	"dropIndex",
]);

const COLLECTION_TARGET_COMMANDS = new Set(["countDocuments", "updateMany"]);

const DUAL_TARGET_COMMANDS = new Set([
	"find",
	"findOne",
	"distinct",
	"insertOne",
	"insertMany",
	"updateOne",
	"deleteOne",
	"deleteMany",
]);

export interface PlaygroundRouteDeps {
	readonly store: ControlPlaneStore;
	readonly secrets: SecretResolver;
}

export function playgroundRoutes(
	deps: PlaygroundRouteDeps,
): OpenAPIHono<AppEnv> {
	const { store, secrets } = deps;
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/playground/execute",
			tags: ["playground"],
			summary: "Execute an Astra Data API command for a workspace",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				body: {
					content: {
						"application/json": {
							schema: ExecutePlaygroundCommandInputSchema,
						},
					},
				},
			},
			responses: {
				200: {
					content: {
						"application/json": {
							schema: ExecutePlaygroundCommandResponseSchema,
						},
					},
					description: "Command executed",
				},
				...errorResponse(400, "Invalid or unsupported Data API command"),
				...errorResponse(404, "Workspace not found"),
				...errorResponse(
					422,
					"Workspace is not an Astra workspace or is missing credentials",
				),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const body = c.req.valid("json");
			const workspace = await store.getWorkspace(workspaceId);
			if (!workspace)
				throw new ControlPlaneNotFoundError("workspace", workspaceId);
			if (workspace.kind !== "astra") {
				throw new ApiError(
					"unsupported_workspace_kind",
					"Playground is available only for Astra workspaces.",
					422,
				);
			}
			const targetKind = inferTargetKind(body);
			const targetName =
				targetKind === "table"
					? (body.table ?? null)
					: (body.collection ?? null);
			validateCommandEnvelope(
				body.commandName,
				body.command,
				targetKind,
				targetName,
				body.collection,
				body.table,
			);

			const endpoint = await resolveEndpoint(workspace, secrets);
			const token = await resolveToken(workspace, secrets);
			// One bounded retry on transient network errors — see
			// `lib/astra-retrying-fetcher.ts`. Same wiring as the
			// control-plane and vector-store DataAPIClient instances.
			const db = new DataAPIClient(token, {
				httpOptions: {
					client: "custom",
					fetcher: new RetryingAstraFetcher(),
				},
			}).db(
				endpoint,
				workspace.keyspace ? { keyspace: workspace.keyspace } : {},
			);
			const started = Date.now();
			const commandOptions = targetName
				? targetKind === "table"
					? { table: targetName }
					: { collection: targetName }
				: undefined;
			const result = await db.command(body.command, commandOptions);

			return c.json(
				{
					ok: true as const,
					commandName: body.commandName,
					targetKind,
					targetName,
					collection: targetKind === "collection" ? targetName : null,
					table: targetKind === "table" ? targetName : null,
					keyspace: workspace.keyspace ?? null,
					command: body.command,
					result,
					elapsedMs: Date.now() - started,
				},
				200,
			);
		},
	);

	return app;
}

function validateCommandEnvelope(
	commandName: z.infer<typeof PlaygroundCommandNameSchema>,
	command: Record<string, unknown>,
	targetKind: z.infer<typeof PlaygroundTargetKindSchema>,
	targetName: string | null | undefined,
	collection: string | null | undefined,
	table: string | null | undefined,
): void {
	const keys = Object.keys(command);
	if (keys.length !== 1 || keys[0] !== commandName) {
		throw new ApiError(
			"invalid_playground_command",
			`command must contain exactly one '${commandName}' property`,
			400,
		);
	}
	const dbLevel = DB_COMMANDS.has(commandName);
	if (targetKind === "table" && collection) {
		throw new ApiError(
			"invalid_playground_command",
			"table commands must not include a collection target",
			400,
		);
	}
	if (targetKind === "collection" && table) {
		throw new ApiError(
			"invalid_playground_command",
			"collection commands must not include a table target",
			400,
		);
	}
	if (dbLevel && targetName) {
		throw new ApiError(
			"invalid_playground_command",
			`'${commandName}' is a keyspace-level command and must not include a ${targetKind} target`,
			400,
		);
	}
	if (TABLE_TARGET_COMMANDS.has(commandName) && targetKind !== "table") {
		throw new ApiError(
			"invalid_playground_command",
			`'${commandName}' must target a table`,
			400,
		);
	}
	if (
		COLLECTION_TARGET_COMMANDS.has(commandName) &&
		targetKind !== "collection"
	) {
		throw new ApiError(
			"invalid_playground_command",
			`'${commandName}' must target a collection`,
			400,
		);
	}
	if (!dbLevel && !targetName) {
		throw new ApiError(
			"invalid_playground_command",
			`'${commandName}' requires a ${targetKind} target`,
			400,
		);
	}
	if (
		!dbLevel &&
		!TABLE_TARGET_COMMANDS.has(commandName) &&
		!COLLECTION_TARGET_COMMANDS.has(commandName) &&
		!DUAL_TARGET_COMMANDS.has(commandName)
	) {
		throw new ApiError(
			"invalid_playground_command",
			`'${commandName}' is not supported in the playground`,
			400,
		);
	}
}

function inferTargetKind(body: {
	readonly commandName: z.infer<typeof PlaygroundCommandNameSchema>;
	readonly targetKind?: z.infer<typeof PlaygroundTargetKindSchema>;
	readonly table?: string | null;
}): z.infer<typeof PlaygroundTargetKindSchema> {
	if (body.targetKind) return body.targetKind;
	if (body.table) return "table";
	if (
		body.commandName === "listTables" ||
		body.commandName === "createTable" ||
		body.commandName === "dropTable" ||
		TABLE_TARGET_COMMANDS.has(body.commandName)
	) {
		return "table";
	}
	return "collection";
}

async function resolveEndpoint(
	workspace: WorkspaceRecord,
	secrets: SecretResolver,
): Promise<string> {
	if (!workspace.url) {
		throw new WorkspaceMisconfiguredError(workspace.uid, "url");
	}
	return resolveMaybeRef(workspace.url, secrets);
}

async function resolveToken(
	workspace: WorkspaceRecord,
	secrets: SecretResolver,
): Promise<string> {
	const tokenRef = workspace.credentials.token;
	if (!tokenRef) {
		throw new WorkspaceMisconfiguredError(workspace.uid, "credentials.token");
	}
	return secrets.resolve(tokenRef);
}

function resolveMaybeRef(
	value: string,
	secrets: SecretResolver,
): Promise<string> {
	const colon = value.indexOf(":");
	if (colon > 0) {
		const prefix = value.slice(0, colon);
		if (secrets.has(prefix)) return secrets.resolve(value);
	}
	return Promise.resolve(value);
}
