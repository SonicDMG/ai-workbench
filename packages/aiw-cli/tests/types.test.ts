/**
 * Smoke tests for the wire schemas. They're the boundary contract
 * between the CLI and the runtime — a regression in `passthrough()`
 * or an over-eager required field would surface as silently-failing
 * command output rather than a 400 on the wire, so we lock the basics.
 */

import { describe, expect, test } from "vitest";
import {
	AgentListSchema,
	AgentSchema,
	DocumentSchema,
	JobSchema,
	KnowledgeBaseListSchema,
	KnowledgeBaseSchema,
	SearchHitSchema,
	SearchResponseSchema,
	WhoAmISchema,
	WorkspaceListSchema,
	WorkspaceSchema,
} from "../src/types.js";

describe("WorkspaceSchema", () => {
	test("requires workspaceId + name; tolerates unknown fields", () => {
		expect(
			WorkspaceSchema.parse({
				workspaceId: "ws-1",
				name: "prod",
				secretFutureField: "tolerated",
			}),
		).toMatchObject({ workspaceId: "ws-1", name: "prod" });
	});

	test("rejects payloads missing workspaceId", () => {
		expect(() => WorkspaceSchema.parse({ name: "prod" })).toThrow();
	});
});

describe("List envelope schemas", () => {
	test("WorkspaceListSchema requires items[]", () => {
		expect(
			WorkspaceListSchema.parse({
				items: [{ workspaceId: "w", name: "n" }],
				nextCursor: null,
			}),
		).toMatchObject({
			items: [{ workspaceId: "w" }],
			nextCursor: null,
		});
	});

	test("nextCursor is optional and may be null", () => {
		const parsed = KnowledgeBaseListSchema.parse({
			items: [{ knowledgeBaseId: "kb", name: "n" }],
		});
		expect(parsed.items).toHaveLength(1);
	});

	test("AgentListSchema rejects a missing items field", () => {
		expect(() => AgentListSchema.parse({})).toThrow();
	});
});

describe("AgentSchema, DocumentSchema, JobSchema", () => {
	test("AgentSchema requires agentId + name", () => {
		expect(AgentSchema.parse({ agentId: "a", name: "x" })).toMatchObject({
			agentId: "a",
		});
		expect(() => AgentSchema.parse({ agentId: "a" })).toThrow();
	});

	test("DocumentSchema accepts an entirely-empty object (everything optional)", () => {
		expect(() => DocumentSchema.parse({})).not.toThrow();
	});

	test("JobSchema requires jobId; nullable fields accept null", () => {
		expect(
			JobSchema.parse({
				jobId: "j",
				knowledgeBaseId: null,
				documentId: null,
				total: null,
				errorMessage: null,
			}),
		).toMatchObject({ jobId: "j", knowledgeBaseId: null });
	});
});

describe("SearchResponseSchema is a bare array (no envelope)", () => {
	test("parses an array of hits", () => {
		const parsed = SearchResponseSchema.parse([
			{ id: "h1", score: 0.9, payload: { title: "x" } },
		]);
		expect(parsed).toHaveLength(1);
	});

	test("rejects an envelope-shaped payload", () => {
		expect(() => SearchResponseSchema.parse({ items: [] })).toThrow();
	});

	test("SearchHitSchema requires id + score", () => {
		expect(() => SearchHitSchema.parse({ id: "h" })).toThrow();
		expect(SearchHitSchema.parse({ id: "h", score: 0.5 })).toMatchObject({
			id: "h",
		});
	});
});

describe("WhoAmISchema", () => {
	test("accepts an entirely-empty object (everything optional)", () => {
		expect(() => WhoAmISchema.parse({})).not.toThrow();
	});

	test("accepts a fully-populated subject", () => {
		const parsed = WhoAmISchema.parse({
			id: "alice",
			label: "Alice",
			type: "oidc",
			workspaceScopes: ["ws-1", "ws-2"],
			scopes: ["read", "write"],
		});
		expect(parsed.id).toBe("alice");
	});

	test("workspaceScopes may be null", () => {
		expect(() =>
			WhoAmISchema.parse({ id: "alice", workspaceScopes: null }),
		).not.toThrow();
	});
});
