import { z } from "zod";

// Mirror of the runtime's schemas (see
// runtimes/typescript/src/openapi/schemas.ts). Keep in sync when the
// contract changes — the drift-guard conformance tests will catch
// backend shifts, but the UI is on its own to track them here.

export const WorkspaceKindSchema = z.enum(["astra", "hcd", "openrag", "mock"]);
export type WorkspaceKind = z.infer<typeof WorkspaceKindSchema>;

export const SecretRefSchema = z
	.string()
	.regex(/^[a-z][a-z0-9]*:.+/i, "Expected '<provider>:<path>', e.g. 'env:FOO'");

export const WorkspaceRecordSchema = z.object({
	uid: z.string().uuid(),
	name: z.string(),
	url: z.string().nullable(),
	kind: WorkspaceKindSchema,
	credentialsRef: z.record(z.string(), z.string()),
	keyspace: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type Workspace = z.infer<typeof WorkspaceRecordSchema>;

export const CreateWorkspaceSchema = z.object({
	name: z.string().min(1, "Name is required"),
	kind: WorkspaceKindSchema,
	url: z.string().url().or(z.literal("")).nullable().optional(),
	keyspace: z.string().or(z.literal("")).nullable().optional(),
	credentialsRef: z.record(z.string(), SecretRefSchema).optional(),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

export const UpdateWorkspaceSchema = z.object({
	name: z.string().min(1, "Name is required").optional(),
	url: z.string().url().or(z.literal("")).nullable().optional(),
	keyspace: z.string().or(z.literal("")).nullable().optional(),
	credentialsRef: z.record(z.string(), SecretRefSchema).optional(),
});
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceSchema>;

export const ErrorEnvelopeSchema = z.object({
	error: z.object({
		code: z.string(),
		message: z.string(),
		requestId: z.string(),
	}),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

export const KIND_LABELS: Record<WorkspaceKind, string> = {
	astra: "Astra DB",
	hcd: "Hyper-Converged Database",
	openrag: "OpenRAG",
	mock: "Mock (in-memory)",
};

export const KIND_DESCRIPTIONS: Record<WorkspaceKind, string> = {
	astra: "DataStax Astra DB via the Data API. Production-grade managed cloud.",
	hcd: "Hyper-Converged Database — Astra's self-hosted cousin. Routing coming later.",
	openrag: "The OpenRAG project. Routing coming later.",
	mock: "In-memory backend for local development and smoke tests. No persistence, no credentials.",
};
