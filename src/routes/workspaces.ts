import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { checkWorkspaceAuth } from "../lib/auth.js";
import { errorEnvelope } from "../lib/errors.js";
import { redact } from "../lib/redact.js";
import type { AppEnv } from "../lib/types.js";
import {
	ErrorEnvelopeSchema,
	WorkspaceDetailSchema,
	WorkspaceIdParamSchema,
	WorkspacesListSchema,
} from "../openapi/schemas.js";
import type { WorkspaceRegistry } from "../workspaces/registry.js";

export function workspaceRoutes(registry: WorkspaceRegistry) {
	const app = new OpenAPIHono<AppEnv>();

	const listRoute = createRoute({
		method: "get",
		path: "/",
		tags: ["workspaces"],
		summary: "List workspaces",
		description: "Returns all workspaces defined in workbench.yaml.",
		responses: {
			200: {
				content: { "application/json": { schema: WorkspacesListSchema } },
				description: "List of workspaces",
			},
		},
	});
	app.openapi(listRoute, (c) =>
		c.json(
			{
				data: registry.list().map((w) => ({
					id: w.config.id,
					driver: w.config.driver,
					description: w.config.description,
				})),
			},
			200,
		),
	);

	const detailRoute = createRoute({
		method: "get",
		path: "/{workspaceId}",
		tags: ["workspaces"],
		summary: "Get workspace details",
		description:
			"Returns the resolved (redacted) configuration of a single workspace. Enforces the workspace's declared auth.",
		security: [{ BearerAuth: [] }],
		request: {
			params: z.object({ workspaceId: WorkspaceIdParamSchema }),
		},
		responses: {
			200: {
				content: { "application/json": { schema: WorkspaceDetailSchema } },
				description: "Workspace detail with secrets redacted",
			},
			401: {
				content: { "application/json": { schema: ErrorEnvelopeSchema } },
				description: "Missing or malformed Authorization header",
			},
			403: {
				content: { "application/json": { schema: ErrorEnvelopeSchema } },
				description: "Token not authorized for this workspace",
			},
			404: {
				content: { "application/json": { schema: ErrorEnvelopeSchema } },
				description: "Workspace not found",
			},
		},
	});
	app.openapi(detailRoute, (c) => {
		const { workspaceId } = c.req.valid("param");
		const ws = registry.get(workspaceId);
		if (!ws) {
			return c.json(
				errorEnvelope(
					c,
					"workspace_not_found",
					`Workspace '${workspaceId}' is not defined`,
				),
				404,
			);
		}
		const auth = checkWorkspaceAuth(c, ws);
		if (!auth.ok) {
			return c.json(errorEnvelope(c, auth.code, auth.message), auth.status);
		}
		return c.json({ data: redact(ws.config) as Record<string, unknown> }, 200);
	});

	return app;
}
