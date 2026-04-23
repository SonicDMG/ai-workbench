/**
 * `/api/v1/workspaces/{workspaceId}/catalogs/{catalogId}/documents`
 * — document metadata CRUD.
 *
 * `PUT` updates metadata only. Content changes (re-chunk, re-embed) flow
 * through the Phase 2 ingest pipeline once it lands.
 *
 * Both parent UIDs are enforced in every path; the store raises
 * `ControlPlaneNotFoundError("workspace" | "catalog", uid)` before the
 * document layer is consulted, which the global error mapper turns into
 * `workspace_not_found` / `catalog_not_found` 404s.
 */

import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { assertWorkspaceAccess } from "../../auth/authz.js";
import { ControlPlaneNotFoundError } from "../../control-plane/errors.js";
import type { ControlPlaneStore } from "../../control-plane/store.js";
import { makeOpenApi } from "../../lib/openapi.js";
import type { AppEnv } from "../../lib/types.js";
import {
	CatalogIdParamSchema,
	CreateDocumentInputSchema,
	DocumentIdParamSchema,
	DocumentRecordSchema,
	ErrorEnvelopeSchema,
	UpdateDocumentInputSchema,
	WorkspaceIdParamSchema,
} from "../../openapi/schemas.js";

export function documentRoutes(store: ControlPlaneStore): OpenAPIHono<AppEnv> {
	const app = makeOpenApi();

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/catalogs/{catalogId}/documents",
			tags: ["documents"],
			summary: "List documents in a catalog",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: {
						"application/json": { schema: z.array(DocumentRecordSchema) },
					},
					description: "All documents in the catalog",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or catalog not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, catalogId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const rows = await store.listDocuments(workspaceId, catalogId);
			return c.json([...rows], 200);
		},
	);

	app.openapi(
		createRoute({
			method: "post",
			path: "/{workspaceId}/catalogs/{catalogId}/documents",
			tags: ["documents"],
			summary: "Register a document in a catalog",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: CreateDocumentInputSchema },
					},
				},
			},
			responses: {
				201: {
					content: { "application/json": { schema: DocumentRecordSchema } },
					description: "Document created",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace or catalog not found",
				},
				409: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Duplicate uid within the catalog",
				},
			},
		}),
		async (c) => {
			const { workspaceId, catalogId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.createDocument(workspaceId, catalogId, body);
			return c.json(record, 201);
		},
	);

	app.openapi(
		createRoute({
			method: "get",
			path: "/{workspaceId}/catalogs/{catalogId}/documents/{documentId}",
			tags: ["documents"],
			summary: "Get a document",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
					documentId: DocumentIdParamSchema,
				}),
			},
			responses: {
				200: {
					content: { "application/json": { schema: DocumentRecordSchema } },
					description: "Document",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, catalog, or document not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, catalogId, documentId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const record = await store.getDocument(
				workspaceId,
				catalogId,
				documentId,
			);
			if (!record) throw new ControlPlaneNotFoundError("document", documentId);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "put",
			path: "/{workspaceId}/catalogs/{catalogId}/documents/{documentId}",
			tags: ["documents"],
			summary: "Update document metadata",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
					documentId: DocumentIdParamSchema,
				}),
				body: {
					content: {
						"application/json": { schema: UpdateDocumentInputSchema },
					},
				},
			},
			responses: {
				200: {
					content: { "application/json": { schema: DocumentRecordSchema } },
					description: "Updated document",
				},
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, catalog, or document not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, catalogId, documentId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const body = c.req.valid("json");
			const record = await store.updateDocument(
				workspaceId,
				catalogId,
				documentId,
				body,
			);
			return c.json(record, 200);
		},
	);

	app.openapi(
		createRoute({
			method: "delete",
			path: "/{workspaceId}/catalogs/{catalogId}/documents/{documentId}",
			tags: ["documents"],
			summary: "Delete a document",
			request: {
				params: z.object({
					workspaceId: WorkspaceIdParamSchema,
					catalogId: CatalogIdParamSchema,
					documentId: DocumentIdParamSchema,
				}),
			},
			responses: {
				204: { description: "Deleted" },
				404: {
					content: { "application/json": { schema: ErrorEnvelopeSchema } },
					description: "Workspace, catalog, or document not found",
				},
			},
		}),
		async (c) => {
			const { workspaceId, catalogId, documentId } = c.req.valid("param");
			assertWorkspaceAccess(c, workspaceId);
			const { deleted } = await store.deleteDocument(
				workspaceId,
				catalogId,
				documentId,
			);
			if (!deleted) throw new ControlPlaneNotFoundError("document", documentId);
			return c.body(null, 204);
		},
	);

	return app;
}
