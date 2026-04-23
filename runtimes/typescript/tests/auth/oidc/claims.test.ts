import type { JWTPayload } from "jose";
import { describe, expect, test } from "vitest";
import { subjectFromClaims } from "../../../src/auth/oidc/claims.js";
import type { OidcConfig } from "../../../src/config/schema.js";

const baseConfig: OidcConfig = {
	issuer: "https://idp.example.com",
	audience: "workbench",
	jwksUri: null,
	clockToleranceSeconds: 30,
	claims: {
		subject: "sub",
		label: "email",
		workspaceScopes: "wb_workspace_scopes",
	},
};

function subjectWith(payload: JWTPayload, overrides?: Partial<OidcConfig>) {
	return subjectFromClaims(payload, { ...baseConfig, ...overrides });
}

describe("subjectFromClaims", () => {
	test("maps sub / email / wb_workspace_scopes by default", () => {
		const subj = subjectWith({
			sub: "user-1",
			email: "alice@example.com",
			wb_workspace_scopes: ["wa", "wb"],
		});
		expect(subj).toEqual({
			type: "oidc",
			id: "user-1",
			label: "alice@example.com",
			workspaceScopes: ["wa", "wb"],
		});
	});

	test("label is null when the configured label claim is missing", () => {
		const subj = subjectWith({ sub: "user-1" });
		expect(subj.label).toBe(null);
	});

	test("missing scope claim defaults to empty array (no workspace access)", () => {
		const subj = subjectWith({ sub: "user-1", email: "a@b.c" });
		expect(subj.workspaceScopes).toEqual([]);
	});

	test("explicit null scope claim marks the subject unscoped", () => {
		const subj = subjectWith({
			sub: "user-1",
			wb_workspace_scopes: null,
		});
		expect(subj.workspaceScopes).toBe(null);
	});

	test("space-separated string scope is split", () => {
		const subj = subjectWith({
			sub: "user-1",
			wb_workspace_scopes: "wa wb  wc",
		});
		expect(subj.workspaceScopes).toEqual(["wa", "wb", "wc"]);
	});

	test("non-string array entries are dropped", () => {
		const subj = subjectWith({
			sub: "user-1",
			wb_workspace_scopes: ["wa", 42, null, "wb"],
		} as JWTPayload);
		expect(subj.workspaceScopes).toEqual(["wa", "wb"]);
	});

	test("honors custom claim names from config", () => {
		const subj = subjectWith(
			{
				user_id: "u-42",
				preferred_username: "alice",
				workspaces: ["wa"],
			},
			{
				claims: {
					subject: "user_id",
					label: "preferred_username",
					workspaceScopes: "workspaces",
				},
			},
		);
		expect(subj.id).toBe("u-42");
		expect(subj.label).toBe("alice");
		expect(subj.workspaceScopes).toEqual(["wa"]);
	});

	test("throws when the subject claim is missing", () => {
		expect(() => subjectWith({ email: "a@b.c" })).toThrow(/'sub' claim/);
	});
});
