import { z } from "@hono/zod-openapi";

export const BannerSchema = z
	.object({
		name: z.string().openapi({ example: "ai-workbench" }),
		version: z.string().openapi({ example: "0.0.0" }),
		commit: z.string().openapi({ example: "abc1234" }),
		docs: z.string().openapi({ example: "/docs" }),
	})
	.openapi("Banner");

export const HealthSchema = z
	.object({
		status: z.literal("ok"),
	})
	.openapi("Health");

export const ReadySchema = z
	.object({
		status: z.literal("ready"),
		workspaces: z.array(z.string()).openapi({ example: ["mock"] }),
	})
	.openapi("Ready");

export const VersionSchema = z
	.object({
		version: z.string().openapi({ example: "0.0.0" }),
		commit: z.string().openapi({ example: "abc1234" }),
		buildTime: z.string().openapi({ example: "2026-04-21T10:30:00Z" }),
		node: z.string().openapi({ example: "v22.11.0" }),
	})
	.openapi("Version");

export const ErrorEnvelopeSchema = z
	.object({
		error: z.object({
			code: z.string().openapi({ example: "workspace_not_found" }),
			message: z.string(),
			requestId: z.string().openapi({ example: "01HY2Z..." }),
		}),
	})
	.openapi("ErrorEnvelope");

export const WorkspaceListItemSchema = z
	.object({
		id: z.string().openapi({ example: "mock" }),
		driver: z.enum(["astra", "mock"]),
		description: z.string().optional(),
	})
	.openapi("WorkspaceListItem");

export const WorkspacesListSchema = z
	.object({
		data: z.array(WorkspaceListItemSchema),
	})
	.openapi("WorkspacesList");

// Workspace detail is a redacted view of the workspace config; its exact shape
// depends on driver, auth, vectorStores, catalogs. For OpenAPI we describe the
// common surface. `data` is the redacted config object.
export const WorkspaceDetailSchema = z
	.object({
		data: z.record(z.string(), z.unknown()).openapi({
			description:
				"Redacted workspace configuration. Secrets are masked as '****'.",
		}),
	})
	.openapi("WorkspaceDetail");

export const WorkspaceIdParamSchema = z
	.string()
	.regex(/^[a-z][a-z0-9-]{0,63}$/)
	.openapi({
		param: { name: "workspaceId", in: "path" },
		example: "mock",
	});
