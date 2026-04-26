/**
 * End-to-end browser-login flow exercised through the real app.
 *
 * We stand up a mocked IdP (discovery + token endpoint), point the
 * runtime at it, and walk through:
 *
 *   GET /auth/login          → 302 to authorize with PKCE
 *   GET /auth/callback?code  → 302 + Set-Cookie session
 *   GET /auth/me             → 200 with the JWT's claims
 *   POST /auth/logout        → Set-Cookie clears it
 *
 * The access token is a JWT we sign locally with a throwaway key;
 * the OidcVerifier inside the app is wired to that same key so the
 * callback's self-verification step passes.
 */

import {
	type CryptoKey,
	exportJWK,
	generateKeyPair,
	importJWK,
	type JWK,
	SignJWT,
} from "jose";
import { beforeAll, describe, expect, test } from "vitest";
import { createApp } from "../../../../src/app.js";
import {
	generateSessionKey,
	makeCookieSigner,
} from "../../../../src/auth/oidc/login/cookie.js";
import { MemoryPendingLoginStore } from "../../../../src/auth/oidc/login/pending.js";
import { OidcVerifier } from "../../../../src/auth/oidc/verifier.js";
import { AuthResolver } from "../../../../src/auth/resolver.js";
import type { AuthConfig } from "../../../../src/config/schema.js";
import { MemoryControlPlaneStore } from "../../../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../../../src/drivers/registry.js";
import { EnvSecretProvider } from "../../../../src/secrets/env.js";
import { SecretResolver } from "../../../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../../../helpers/embedder.js";

const ISSUER = "https://idp.test.example.com";
const AUD = "workbench";
const ALG = "RS256";
const KID = "kid-1";

async function makeFixtures() {
	const { publicKey, privateKey } = await generateKeyPair(ALG, {
		extractable: true,
	});
	const publicJwk: JWK = {
		...(await exportJWK(publicKey)),
		alg: ALG,
		kid: KID,
	};
	const imported = await importJWK(publicJwk, ALG);
	return { privateKey, imported };
}

async function mintJwt(
	privateKey: CryptoKey,
	overrides: { sub: string; scopes?: string[]; email?: string },
): Promise<string> {
	return await new SignJWT({
		sub: overrides.sub,
		email: overrides.email ?? `${overrides.sub}@test`,
		wb_workspace_scopes: overrides.scopes ?? [],
	})
		.setProtectedHeader({ alg: ALG, kid: KID })
		.setIssuedAt()
		.setIssuer(ISSUER)
		.setAudience(AUD)
		.setExpirationTime("2h")
		.sign(privateKey);
}

function authConfig(): AuthConfig {
	return {
		mode: "oidc",
		anonymousPolicy: "reject",
		oidc: {
			issuer: ISSUER,
			audience: AUD,
			jwksUri: null,
			clockToleranceSeconds: 30,
			claims: {
				subject: "sub",
				label: "email",
				workspaceScopes: "wb_workspace_scopes",
			},
			client: {
				clientId: "client-1",
				clientSecretRef: null,
				redirectPath: "/auth/callback",
				postLogoutPath: "/",
				scopes: ["openid", "profile", "email"],
				sessionCookieName: "wb_session",
				sessionSecretRef: null,
			},
		},
	};
}

async function buildAppWithLogin(privateKey: CryptoKey, imported: unknown) {
	const store = new MemoryControlPlaneStore();
	const ws = await store.createWorkspace({ name: "w", kind: "mock" });
	const drivers = new VectorStoreDriverRegistry(
		new Map([["mock", new MockVectorStoreDriver()]]),
	);
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });

	const cfg = authConfig();
	const cookie = makeCookieSigner(generateSessionKey());
	const pending = new MemoryPendingLoginStore();

	// The OIDC verifier reuses the same imported key that our mock
	// IdP will return tokens signed against.
	const getKey = async () => imported as Awaited<ReturnType<typeof importJWK>>;
	const oidc = cfg.oidc;
	if (!oidc) throw new Error("test auth config must include oidc");
	const auth = new AuthResolver({
		mode: "oidc",
		anonymousPolicy: "reject",
		verifiers: [new OidcVerifier({ config: oidc, getKey })],
	});

	// A stub token endpoint. The route handler calls this via global
	// fetch; override it for the duration of each test.
	const mintedByCode = new Map<string, string>();
	// Phase 3c: tokens issued against a refresh_token grant. Tests
	// register the same JWT they want the IdP to "mint" on refresh.
	const mintedByRefresh = new Map<string, string>();
	let lastIssuedRefreshToken: string | null = null;
	const origFetch = globalThis.fetch;
	globalThis.fetch = (async (
		input: URL | string | Request,
		init?: RequestInit,
	) => {
		const url =
			typeof input === "string"
				? input
				: input instanceof URL
					? input.toString()
					: input.url;
		if (url.endsWith("/token")) {
			const body = new URLSearchParams(String(init?.body ?? ""));
			const grant = body.get("grant_type") ?? "";

			if (grant === "refresh_token") {
				const rt = body.get("refresh_token") ?? "";
				const token = mintedByRefresh.get(rt);
				if (!token) {
					return new Response(JSON.stringify({ error: "invalid_grant" }), {
						status: 400,
					});
				}
				return new Response(
					JSON.stringify({
						access_token: token,
						token_type: "Bearer",
						expires_in: 3600,
						id_token: token,
						// IdPs that rotate hand back a new RT; we leave it
						// matching the input here so tests can re-use it.
						refresh_token: rt,
					}),
					{ status: 200 },
				);
			}

			const code = body.get("code") ?? "";
			const token = mintedByCode.get(code);
			if (!token) {
				return new Response(JSON.stringify({ error: "invalid_grant" }), {
					status: 400,
				});
			}
			// Mint a refresh_token alongside so the cookie carries one.
			const rt = `rt-${code}`;
			lastIssuedRefreshToken = rt;
			mintedByRefresh.set(rt, token);
			return new Response(
				JSON.stringify({
					access_token: token,
					token_type: "Bearer",
					expires_in: 3600,
					id_token: token,
					refresh_token: rt,
				}),
				{ status: 200 },
			);
		}
		return origFetch(input as Request, init);
	}) as typeof fetch;

	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders: makeFakeEmbedderFactory(),
		login: {
			authConfig: cfg,
			endpoints: {
				authorizationEndpoint: `${ISSUER}/authorize`,
				tokenEndpoint: `${ISSUER}/token`,
				endSessionEndpoint: null,
				jwksUri: `${ISSUER}/jwks`,
			},
			clientSecret: null,
			cookie,
			pending,
		},
	});

	return {
		app,
		workspace: ws,
		mintedByCode,
		mintedByRefresh,
		getLastIssuedRefreshToken: () => lastIssuedRefreshToken,
		pending,
		cookie,
		cfg,
		privateKey,
		restoreFetch: () => {
			globalThis.fetch = origFetch;
		},
	};
}

describe("/auth/* flow", () => {
	let privateKey: CryptoKey;
	let imported: Awaited<ReturnType<typeof importJWK>>;
	beforeAll(async () => {
		const f = await makeFixtures();
		privateKey = f.privateKey;
		imported = f.imported;
	});

	test("/auth/config advertises the login entry point", async () => {
		const fx = await buildAppWithLogin(privateKey, imported);
		try {
			const res = await fx.app.request("/auth/config");
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				modes: { login: boolean };
				loginPath: string | null;
			};
			expect(body.modes.login).toBe(true);
			expect(body.loginPath).toBe("/auth/login");
		} finally {
			fx.restoreFetch();
		}
	});

	test("login → callback → me → logout", async () => {
		const fx = await buildAppWithLogin(privateKey, imported);
		try {
			// 1. GET /auth/login → 302 to IdP, state persisted.
			const loginRes = await fx.app.request(
				"/auth/login?redirect_after=/workspaces",
				{ headers: { host: "app.test" } },
			);
			expect(loginRes.status).toBe(302);
			const authorizeUrl = new URL(loginRes.headers.get("location") ?? "");
			expect(authorizeUrl.origin).toBe(ISSUER);
			expect(authorizeUrl.searchParams.get("client_id")).toBe("client-1");
			expect(authorizeUrl.searchParams.get("response_type")).toBe("code");
			expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe(
				"S256",
			);
			const state = authorizeUrl.searchParams.get("state");
			expect(state).toBeTruthy();

			// 2. Simulate the IdP: mint a JWT and pretend it was exchanged
			//    for this `code`.
			const code = "auth-code-1";
			const jwt = await mintJwt(privateKey, {
				sub: "alice",
				email: "alice@ex.com",
				scopes: [fx.workspace.uid],
			});
			fx.mintedByCode.set(code, jwt);

			// 3. GET /auth/callback → 302 + Set-Cookie.
			const cbRes = await fx.app.request(
				`/auth/callback?state=${state}&code=${code}`,
				{ headers: { host: "app.test" } },
			);
			expect(cbRes.status).toBe(302);
			expect(cbRes.headers.get("location")).toBe("/workspaces");
			const setCookie = cbRes.headers.get("set-cookie") ?? "";
			expect(setCookie).toMatch(/^wb_session=/);
			expect(setCookie).toMatch(/HttpOnly/);
			expect(setCookie).toMatch(/SameSite=Lax/);
			const cookieValue = setCookie.slice(
				"wb_session=".length,
				setCookie.indexOf(";"),
			);

			// 4. GET /auth/me with the cookie → 200 with subject.
			const meRes = await fx.app.request("/auth/me", {
				headers: { cookie: `wb_session=${cookieValue}` },
			});
			expect(meRes.status).toBe(200);
			const me = (await meRes.json()) as {
				id: string;
				label: string | null;
				type: string;
			};
			expect(me.id).toBe("alice");
			expect(me.label).toBe("alice@ex.com");
			expect(me.type).toBe("oidc");

			// 5. An actual workspace-scoped API call with just the cookie.
			const apiRes = await fx.app.request(
				`/api/v1/workspaces/${fx.workspace.uid}`,
				{ headers: { cookie: `wb_session=${cookieValue}` } },
			);
			expect(apiRes.status).toBe(200);

			// 6. POST /auth/logout → clears the cookie.
			const outRes = await fx.app.request("/auth/logout", { method: "POST" });
			expect(outRes.status).toBe(200);
			expect(outRes.headers.get("set-cookie")).toMatch(/Max-Age=0/);
		} finally {
			fx.restoreFetch();
		}
	});

	test("unknown state at callback is rejected", async () => {
		const fx = await buildAppWithLogin(privateKey, imported);
		try {
			const res = await fx.app.request(
				"/auth/callback?state=forged&code=whatever",
			);
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("invalid_state");
		} finally {
			fx.restoreFetch();
		}
	});

	test("/auth/me without a valid session → 401", async () => {
		const fx = await buildAppWithLogin(privateKey, imported);
		try {
			const res = await fx.app.request("/auth/me");
			expect(res.status).toBe(401);
		} finally {
			fx.restoreFetch();
		}
	});

	test("tampered cookie fails decryption - treated as anonymous", async () => {
		const fx = await buildAppWithLogin(privateKey, imported);
		try {
			// Forge the shape but with a random payload that won't match.
			const res = await fx.app.request("/auth/me", {
				headers: { cookie: "wb_session=bogus.AAAA" },
			});
			expect(res.status).toBe(401);
		} finally {
			fx.restoreFetch();
		}
	});

	test("/auth/config advertises refreshPath when login is wired", async () => {
		const fx = await buildAppWithLogin(privateKey, imported);
		try {
			const res = await fx.app.request("/auth/config");
			const body = (await res.json()) as { refreshPath: string | null };
			expect(body.refreshPath).toBe("/auth/refresh");
		} finally {
			fx.restoreFetch();
		}
	});

	test("/auth/me exposes expiresAt and canRefresh from the cookie", async () => {
		const fx = await buildAppWithLogin(privateKey, imported);
		try {
			// Run a full callback so we get a real cookie carrying the
			// JWT we just minted.
			const code = "code-me-1";
			const jwt = await mintJwt(privateKey, { sub: "alice" });
			fx.mintedByCode.set(code, jwt);

			const loginRes = await fx.app.request("/auth/login", {
				headers: { host: "app.test" },
			});
			const state = new URL(
				loginRes.headers.get("location") ?? "",
			).searchParams.get("state");
			const cbRes = await fx.app.request(
				`/auth/callback?state=${state}&code=${code}`,
				{ headers: { host: "app.test" } },
			);
			const setCookie = cbRes.headers.get("set-cookie") ?? "";
			const cookieValue = setCookie.slice(
				"wb_session=".length,
				setCookie.indexOf(";"),
			);

			const meRes = await fx.app.request("/auth/me", {
				headers: { cookie: `wb_session=${cookieValue}` },
			});
			expect(meRes.status).toBe(200);
			const me = (await meRes.json()) as {
				expiresAt: number | null;
				canRefresh: boolean;
			};
			expect(typeof me.expiresAt).toBe("number");
			expect((me.expiresAt ?? 0) > Math.floor(Date.now() / 1000)).toBe(true);
			expect(me.canRefresh).toBe(true);
		} finally {
			fx.restoreFetch();
		}
	});

	test("/auth/refresh swaps the cookie for a fresh access token", async () => {
		const fx = await buildAppWithLogin(privateKey, imported);
		try {
			// Walk through callback to seed the cookie with an rt.
			const code = "code-refresh-1";
			const jwt1 = await mintJwt(privateKey, { sub: "alice" });
			fx.mintedByCode.set(code, jwt1);

			const loginRes = await fx.app.request("/auth/login", {
				headers: { host: "app.test" },
			});
			const state = new URL(
				loginRes.headers.get("location") ?? "",
			).searchParams.get("state");
			const cbRes = await fx.app.request(
				`/auth/callback?state=${state}&code=${code}`,
				{ headers: { host: "app.test" } },
			);
			const setCookie1 = cbRes.headers.get("set-cookie") ?? "";
			const cookie1 = setCookie1.slice(
				"wb_session=".length,
				setCookie1.indexOf(";"),
			);

			// Re-bind the same refresh_token to a freshly-minted JWT —
			// simulates the IdP issuing a new access_token on refresh.
			const rt = fx.getLastIssuedRefreshToken();
			expect(rt).toBeTruthy();
			const jwt2 = await mintJwt(privateKey, { sub: "alice" });
			fx.mintedByRefresh.set(rt as string, jwt2);

			const refreshRes = await fx.app.request("/auth/refresh", {
				method: "POST",
				headers: { cookie: `wb_session=${cookie1}` },
			});
			expect(refreshRes.status).toBe(200);
			const body = (await refreshRes.json()) as {
				ok: boolean;
				expiresAt: number | null;
			};
			expect(body.ok).toBe(true);
			expect(typeof body.expiresAt).toBe("number");

			// New cookie was issued and decodes to the new JWT.
			const setCookie2 = refreshRes.headers.get("set-cookie") ?? "";
			expect(setCookie2).toMatch(/^wb_session=/);
			const cookie2 = decodeURIComponent(
				setCookie2.slice("wb_session=".length, setCookie2.indexOf(";")),
			);
			const payload = fx.cookie.verify(cookie2);
			expect(payload?.accessToken).toBe(jwt2);
			expect(payload?.refreshToken).toBe(rt);
		} finally {
			fx.restoreFetch();
		}
	});

	test("/auth/refresh without a session cookie → 401 no_refresh_token", async () => {
		const fx = await buildAppWithLogin(privateKey, imported);
		try {
			const res = await fx.app.request("/auth/refresh", { method: "POST" });
			expect(res.status).toBe(401);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("no_refresh_token");
		} finally {
			fx.restoreFetch();
		}
	});

	test("/auth/refresh clears the cookie when the IdP rejects the rt", async () => {
		const fx = await buildAppWithLogin(privateKey, imported);
		try {
			// Manually craft a session cookie carrying a refresh_token
			// the mock IdP doesn't recognize.
			const handcrafted = fx.cookie.sign({
				accessToken: await mintJwt(privateKey, { sub: "alice" }),
				issuedAt: Math.floor(Date.now() / 1000),
				refreshToken: "rt-totally-bogus",
			});
			const res = await fx.app.request("/auth/refresh", {
				method: "POST",
				headers: {
					cookie: `wb_session=${encodeURIComponent(handcrafted)}`,
				},
			});
			expect(res.status).toBe(401);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("refresh_failed");
			// Cookie was cleared.
			expect(res.headers.get("set-cookie")).toMatch(/Max-Age=0/);
		} finally {
			fx.restoreFetch();
		}
	});

	test("redirect_after is sanitized — protocol URLs get replaced with /", async () => {
		const fx = await buildAppWithLogin(privateKey, imported);
		try {
			const res = await fx.app.request(
				"/auth/login?redirect_after=https://attacker.com/phish",
				{ headers: { host: "app.test" } },
			);
			expect(res.status).toBe(302);
			const state = new URL(res.headers.get("location") ?? "").searchParams.get(
				"state",
			);
			expect(state).toBeTruthy();
			if (!state) throw new Error("expected login redirect to include state");
			const entry = fx.pending.take(state);
			expect(entry?.redirectAfter).toBe("/");
		} finally {
			fx.restoreFetch();
		}
	});
});

describe("/auth/* without browser-login configured", () => {
	test("/auth/config reports login: false and returns 404 on /auth/login", async () => {
		const store = new MemoryControlPlaneStore();
		const drivers = new VectorStoreDriverRegistry(
			new Map([["mock", new MockVectorStoreDriver()]]),
		);
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		const auth = new AuthResolver({
			mode: "disabled",
			anonymousPolicy: "allow",
			verifiers: [],
		});
		const app = createApp({
			store,
			drivers,
			secrets,
			auth,
			embedders: makeFakeEmbedderFactory(),
			login: {
				authConfig: {
					mode: "disabled",
					anonymousPolicy: "allow",
				} as AuthConfig,
				endpoints: null,
				clientSecret: null,
				cookie: null,
				pending: null,
			},
		});

		const cfgRes = await app.request("/auth/config");
		expect(cfgRes.status).toBe(200);
		const cfg = (await cfgRes.json()) as { modes: { login: boolean } };
		expect(cfg.modes.login).toBe(false);

		const loginRes = await app.request("/auth/login");
		expect(loginRes.status).toBe(404);
	});
});
