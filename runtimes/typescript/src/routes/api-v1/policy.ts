/**
 * `/api/v1/workspaces/{workspaceId}/policy/*` — RLAC policy authoring
 * and audit-tail surface.
 *
 *   POST  /policy/compile-preview  — parse + validate + compile a DSL
 *                                    string for a given principal.
 *                                    Drives the policy-editor UI's
 *                                    "compiled filter" panel and
 *                                    translatability report.
 *   GET   /policy/audit             — list recent policy decisions
 *                                    for the workspace.
 *
 * Both surfaces are workbench-side affordances. They have no Data API
 * dependency — the compiler is pure TypeScript and the audit log is
 * stored in the control plane.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import { errorResponse, makeOpenApi } from "../../lib/openapi.js";
import type { AppEnv } from "../../lib/types.js";
import {
	PolicyAuditPageSchema,
	PolicyAuditQuerySchema,
	PolicyCompilePreviewRequestSchema,
	PolicyCompilePreviewResponseSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";
import {
	compilePolicy,
	PolicyParseError,
	type PrincipalContext,
	parsePolicy,
	validatePolicy,
} from "../../policy/index.js";

export function policyRoutes(store: ControlPlaneStore): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/policy/compile-preview",
			tags: ["rlac", "policy"],
			summary: "Parse, validate, and compile a policy DSL",
			description:
				"Returns the parsed-and-compiled Data API filter for the supplied principal, alongside a list of translatability issues. The UI uses this as a live preview while the user authors a policy.",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				body: {
					content: {
						"application/json": {
							schema: PolicyCompilePreviewRequestSchema,
						},
					},
				},
			},
			responses: {
				200: {
					content: {
						"application/json": {
							schema: PolicyCompilePreviewResponseSchema,
						},
					},
					description: "Compilation result",
				},
				...errorResponse(404, "Workspace not found"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const body = c.req.valid("json");
			// Resolve the principal context if the caller supplied one.
			// Missing principal → compile against a sentinel id so the
			// `current_principal_id()` slot still resolves, but UI flags
			// the response with `principalId: null` to make the
			// substitution explicit.
			let principal: PrincipalContext;
			if (body.principalId) {
				const record = await store.getPrincipal(workspaceId, body.principalId);
				principal = record
					? {
							id: record.principalId,
							attributes: { ...record.attributes },
						}
					: { id: body.principalId, attributes: {} };
			} else {
				principal = { id: "<unset>", attributes: {} };
			}
			try {
				const ast = parsePolicy(body.dsl);
				const issues = validatePolicy(ast);
				let compiledFilter: unknown = null;
				let compileError: string | null = null;
				try {
					compiledFilter = compilePolicy(ast, principal);
				} catch (err: unknown) {
					compileError = err instanceof Error ? err.message : String(err);
				}
				return c.json(
					{
						ok: issues.length === 0 && compileError === null,
						parseError: compileError,
						issues: [...issues],
						compiledFilter,
						principalId: body.principalId ?? null,
					},
					200,
				);
			} catch (err: unknown) {
				if (err instanceof PolicyParseError) {
					return c.json(
						{
							ok: false,
							parseError: err.message,
							issues: [],
							compiledFilter: null,
							principalId: body.principalId ?? null,
						},
						200,
					);
				}
				throw err;
			}
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/policy/audit",
			tags: ["rlac", "policy"],
			summary: "List recent policy decisions for the workspace",
			request: {
				params: z.object({ workspaceId: WorkspaceIdParamSchema }),
				query: PolicyAuditQuerySchema,
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: PolicyAuditPageSchema },
					},
					description: "Audit tail",
				},
				...errorResponse(404, "Workspace not found"),
			},
		}),
		async (c) => {
			const { workspaceId } = c.req.valid("param");
			const query = c.req.valid("query");
			const rows = await store.listPolicyAudit(workspaceId, {
				principalId: query.principalId,
				knowledgeBaseId: query.knowledgeBaseId,
				auditDay: query.auditDay,
				limit: query.limit,
			});
			return c.json({ items: [...rows], nextCursor: null }, 200);
		},
	);

	return app;
}
