import { describe, expect, test, vi } from "vitest";
import {
	exchangeAuthorizationCode,
	refreshAccessToken,
} from "../../../../src/auth/oidc/login/exchange.js";

function makeFetchMock(response: Response) {
	return vi.fn().mockResolvedValue(response);
}

describe("exchangeAuthorizationCode", () => {
	test("sends the expected form body for a public client", async () => {
		const f = makeFetchMock(
			new Response(
				JSON.stringify({ access_token: "a", token_type: "Bearer" }),
				{
					status: 200,
				},
			),
		);
		await exchangeAuthorizationCode({
			tokenEndpoint: "https://idp/token",
			clientId: "client-1",
			clientSecret: null,
			redirectUri: "https://app/auth/callback",
			code: "the-code",
			codeVerifier: "verifier-xyz",
			fetchImpl: f,
		});
		const [url, init] = f.mock.calls[0] ?? [];
		expect(url).toBe("https://idp/token");
		expect(init?.method).toBe("POST");
		expect(
			(init?.headers as Record<string, string>).authorization,
		).toBeUndefined();
		const body = new URLSearchParams(init?.body as string);
		expect(body.get("grant_type")).toBe("authorization_code");
		expect(body.get("code")).toBe("the-code");
		expect(body.get("client_id")).toBe("client-1");
		expect(body.get("code_verifier")).toBe("verifier-xyz");
		expect(body.get("redirect_uri")).toBe("https://app/auth/callback");
	});

	test("attaches Basic auth when a client secret is configured", async () => {
		const f = makeFetchMock(
			new Response(
				JSON.stringify({ access_token: "a", token_type: "Bearer" }),
				{
					status: 200,
				},
			),
		);
		await exchangeAuthorizationCode({
			tokenEndpoint: "https://idp/token",
			clientId: "c",
			clientSecret: "s3cr3t",
			redirectUri: "/cb",
			code: "x",
			codeVerifier: "v",
			fetchImpl: f,
		});
		const init = f.mock.calls[0]?.[1];
		const headers = init?.headers as Record<string, string>;
		const authHeader = headers.authorization ?? "";
		expect(authHeader).toMatch(/^Basic /);
		const decoded = Buffer.from(
			authHeader.replace(/^Basic /, ""),
			"base64",
		).toString("utf8");
		expect(decoded).toBe("c:s3cr3t");
	});

	test("surfaces a sanitized error on IdP error bodies", async () => {
		const f = makeFetchMock(
			new Response(
				JSON.stringify({ error: "invalid_grant", error_description: "oops" }),
				{ status: 400 },
			),
		);
		await expect(
			exchangeAuthorizationCode({
				tokenEndpoint: "https://idp/token",
				clientId: "c",
				clientSecret: null,
				redirectUri: "/cb",
				code: "x",
				codeVerifier: "v",
				fetchImpl: f,
			}),
		).rejects.toThrow(/invalid_grant/);
	});

	test("throws when response body lacks access_token", async () => {
		const f = makeFetchMock(new Response("{}", { status: 200 }));
		await expect(
			exchangeAuthorizationCode({
				tokenEndpoint: "https://idp/token",
				clientId: "c",
				clientSecret: null,
				redirectUri: "/cb",
				code: "x",
				codeVerifier: "v",
				fetchImpl: f,
			}),
		).rejects.toThrow(/missing access_token/);
	});
});

describe("refreshAccessToken", () => {
	test("sends grant_type=refresh_token with the right form fields", async () => {
		const f = makeFetchMock(
			new Response(
				JSON.stringify({
					access_token: "fresh",
					token_type: "Bearer",
					expires_in: 3600,
				}),
				{ status: 200 },
			),
		);
		await refreshAccessToken({
			tokenEndpoint: "https://idp/token",
			clientId: "client-1",
			clientSecret: null,
			refreshToken: "rt-xyz",
			scopes: ["openid", "profile"],
			fetchImpl: f,
		});
		const [url, init] = f.mock.calls[0] ?? [];
		expect(url).toBe("https://idp/token");
		expect(init?.method).toBe("POST");
		const body = new URLSearchParams(init?.body as string);
		expect(body.get("grant_type")).toBe("refresh_token");
		expect(body.get("refresh_token")).toBe("rt-xyz");
		expect(body.get("client_id")).toBe("client-1");
		expect(body.get("scope")).toBe("openid profile");
	});

	test("attaches Basic auth when a client secret is configured", async () => {
		const f = makeFetchMock(
			new Response(
				JSON.stringify({ access_token: "fresh", token_type: "Bearer" }),
				{ status: 200 },
			),
		);
		await refreshAccessToken({
			tokenEndpoint: "https://idp/token",
			clientId: "c",
			clientSecret: "s3cr3t",
			refreshToken: "rt-xyz",
			fetchImpl: f,
		});
		const init = f.mock.calls[0]?.[1];
		const authHeader = (init?.headers as Record<string, string>).authorization;
		expect(authHeader).toMatch(/^Basic /);
		const decoded = Buffer.from(
			(authHeader ?? "").replace(/^Basic /, ""),
			"base64",
		).toString("utf8");
		expect(decoded).toBe("c:s3cr3t");
	});

	test("omits the scope param when no scopes are passed", async () => {
		const f = makeFetchMock(
			new Response(
				JSON.stringify({ access_token: "fresh", token_type: "Bearer" }),
				{ status: 200 },
			),
		);
		await refreshAccessToken({
			tokenEndpoint: "https://idp/token",
			clientId: "c",
			clientSecret: null,
			refreshToken: "rt-xyz",
			fetchImpl: f,
		});
		const body = new URLSearchParams(f.mock.calls[0]?.[1]?.body as string);
		expect(body.get("scope")).toBeNull();
	});

	test("surfaces a sanitized error on IdP error bodies", async () => {
		const f = makeFetchMock(
			new Response(
				JSON.stringify({
					error: "invalid_grant",
					error_description: "rt revoked",
				}),
				{ status: 400 },
			),
		);
		await expect(
			refreshAccessToken({
				tokenEndpoint: "https://idp/token",
				clientId: "c",
				clientSecret: null,
				refreshToken: "rt-xyz",
				fetchImpl: f,
			}),
		).rejects.toThrow(/invalid_grant/);
	});

	test("throws when response body lacks access_token", async () => {
		const f = makeFetchMock(new Response("{}", { status: 200 }));
		await expect(
			refreshAccessToken({
				tokenEndpoint: "https://idp/token",
				clientId: "c",
				clientSecret: null,
				refreshToken: "rt-xyz",
				fetchImpl: f,
			}),
		).rejects.toThrow(/missing access_token/);
	});
});
