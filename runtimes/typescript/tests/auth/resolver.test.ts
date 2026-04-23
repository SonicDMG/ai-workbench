import { describe, expect, test } from "vitest";
import { UnauthorizedError } from "../../src/auth/errors.js";
import { AuthResolver, type TokenVerifier } from "../../src/auth/resolver.js";
import type { AuthSubject } from "../../src/auth/types.js";

function makeRequest(headers: Record<string, string> = {}): Request {
	return new Request("http://test.local/api/v1/workspaces", { headers });
}

describe("AuthResolver", () => {
	test("disabled mode + anonymousPolicy=allow produces an anonymous context with no verifiers", async () => {
		const resolver = new AuthResolver({
			mode: "disabled",
			anonymousPolicy: "allow",
			verifiers: [],
		});
		const ctx = await resolver.authenticate(makeRequest());
		expect(ctx).toEqual({
			mode: "disabled",
			authenticated: false,
			anonymous: true,
			subject: null,
		});
	});

	test("anonymousPolicy=reject without a header raises UnauthorizedError", async () => {
		const resolver = new AuthResolver({
			mode: "disabled",
			anonymousPolicy: "reject",
			verifiers: [],
		});
		await expect(resolver.authenticate(makeRequest())).rejects.toBeInstanceOf(
			UnauthorizedError,
		);
	});

	test("malformed Authorization header raises UnauthorizedError", async () => {
		const resolver = new AuthResolver({
			mode: "apiKey",
			anonymousPolicy: "allow",
			verifiers: [],
		});
		await expect(
			resolver.authenticate(makeRequest({ authorization: "Basic whatever" })),
		).rejects.toBeInstanceOf(UnauthorizedError);
	});

	test("bearer token with no matching verifier raises UnauthorizedError", async () => {
		const resolver = new AuthResolver({
			mode: "apiKey",
			anonymousPolicy: "allow",
			verifiers: [],
		});
		await expect(
			resolver.authenticate(makeRequest({ authorization: "Bearer wb_test" })),
		).rejects.toBeInstanceOf(UnauthorizedError);
	});

	test("first matching verifier produces an authenticated context", async () => {
		const subject: AuthSubject = {
			type: "apiKey",
			id: "key-1",
			label: "ci",
			workspaceScopes: ["00000000-0000-0000-0000-000000000000"],
		};
		const verifier: TokenVerifier = {
			scheme: "apiKey",
			async verify(token) {
				return token === "wb_good" ? subject : null;
			},
		};
		const resolver = new AuthResolver({
			mode: "apiKey",
			anonymousPolicy: "allow",
			verifiers: [verifier],
		});
		const ctx = await resolver.authenticate(
			makeRequest({ authorization: "Bearer wb_good" }),
		);
		expect(ctx).toEqual({
			mode: "apiKey",
			authenticated: true,
			anonymous: false,
			subject,
		});
	});

	test("earlier verifiers returning null yield to later verifiers", async () => {
		let firstCalled = false;
		const first: TokenVerifier = {
			scheme: "apiKey",
			async verify() {
				firstCalled = true;
				return null;
			},
		};
		const second: TokenVerifier = {
			scheme: "oidc",
			async verify() {
				return {
					type: "oidc",
					id: "user-1",
					label: null,
					workspaceScopes: [],
				};
			},
		};
		const resolver = new AuthResolver({
			mode: "any",
			anonymousPolicy: "allow",
			verifiers: [first, second],
		});
		const ctx = await resolver.authenticate(
			makeRequest({ authorization: "Bearer xyz" }),
		);
		expect(firstCalled).toBe(true);
		expect(ctx.authenticated).toBe(true);
		expect(ctx.subject?.id).toBe("user-1");
	});
});
