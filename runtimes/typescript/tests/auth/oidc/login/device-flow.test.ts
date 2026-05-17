/**
 * RFC 8628 device-flow proxy tests.
 *
 * Drives the runtime's `/auth/device/authorize` + `/auth/device/token`
 * endpoints against a mocked IdP. Three behaviors pinned:
 *
 *   1. Happy path — authorize returns a device_code + user_code, then
 *      a token-poll returns the access_token verbatim.
 *   2. Pending — IdP returns `400 authorization_pending`; the proxy
 *      passes it through as `400 { error: { code: ... } }` so the CLI
 *      can keep polling without changing transports.
 *   3. Not advertised — if the discovery doc has no
 *      `device_authorization_endpoint`, both routes respond `501
 *      device_flow_not_supported` instead of crashing.
 */

import { describe, expect, test } from "vitest";
import { createApp } from "../../../../src/app.js";
import {
	generateSessionKey,
	makeCookieSigner,
} from "../../../../src/auth/oidc/login/cookie.js";
import { MemoryPendingLoginStore } from "../../../../src/auth/oidc/login/pending.js";
import { AuthResolver } from "../../../../src/auth/resolver.js";
import type { AuthConfig } from "../../../../src/config/schema.js";
import { MemoryControlPlaneStore } from "../../../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../../../src/drivers/registry.js";
import { EnvSecretProvider } from "../../../../src/secrets/env.js";
import { SecretResolver } from "../../../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../../../helpers/embedder.js";

const ISSUER = "https://idp.test.example.com";
const DEVICE_AUTHORIZE = `${ISSUER}/device/code`;
const TOKEN = `${ISSUER}/token`;

function authConfig(): AuthConfig {
	return {
		mode: "oidc",
		anonymousPolicy: "reject",
		bootstrapTokenRef: null,
		acknowledgeOpenAccess: false,
		oidc: {
			issuer: ISSUER,
			audience: "workbench",
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

interface Harness {
	app: ReturnType<typeof createApp>;
	calls: Array<{ url: string; body: string }>;
	restoreFetch: () => void;
}

async function makeHarness(opts: {
	deviceAuthorizationEndpoint: string | null;
	fetchHandler?: (url: string, body: string) => Response | null;
}): Promise<Harness> {
	const store = new MemoryControlPlaneStore();
	await store.createWorkspace({ name: "w", kind: "mock" });
	const drivers = new VectorStoreDriverRegistry(
		new Map([["mock", new MockVectorStoreDriver()]]),
	);
	const secrets = new SecretResolver({ env: new EnvSecretProvider() });
	const cfg = authConfig();
	const cookie = makeCookieSigner(generateSessionKey());
	const pending = new MemoryPendingLoginStore();
	// The verifier is irrelevant for these tests — device proxy
	// doesn't validate the IdP's tokens itself (it passes them through
	// for subsequent /auth/me calls to validate). A real verifier
	// would 401 every test request; using a deny-all resolver keeps
	// the device-flow path the only thing under test.
	const auth = new AuthResolver({
		mode: "disabled",
		anonymousPolicy: "allow",
		verifiers: [],
	});

	const calls: Array<{ url: string; body: string }> = [];
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
		const body = String(init?.body ?? "");
		calls.push({ url, body });
		const handled = opts.fetchHandler?.(url, body) ?? null;
		if (handled) return handled;
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
				tokenEndpoint: TOKEN,
				endSessionEndpoint: null,
				jwksUri: `${ISSUER}/jwks`,
				deviceAuthorizationEndpoint: opts.deviceAuthorizationEndpoint,
			},
			clientSecret: null,
			cookie,
			pending,
			publicOrigin: null,
			trustProxyHeaders: false,
		},
	});

	return {
		app,
		calls,
		restoreFetch: () => {
			globalThis.fetch = origFetch;
		},
	};
}

describe("OIDC device-flow proxy", () => {
	test("/config advertises modes.device when the IdP exposes the endpoint", async () => {
		const h = await makeHarness({
			deviceAuthorizationEndpoint: DEVICE_AUTHORIZE,
		});
		try {
			const res = await h.app.request("/auth/config");
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				modes: { device?: boolean };
				deviceAuthorizePath: string | null;
				deviceTokenPath: string | null;
			};
			expect(body.modes.device).toBe(true);
			expect(body.deviceAuthorizePath).toBe("/auth/device/authorize");
			expect(body.deviceTokenPath).toBe("/auth/device/token");
		} finally {
			h.restoreFetch();
		}
	});

	test("/config marks modes.device false + nulls the paths when the IdP doesn't advertise it", async () => {
		const h = await makeHarness({ deviceAuthorizationEndpoint: null });
		try {
			const res = await h.app.request("/auth/config");
			const body = (await res.json()) as {
				modes: { device?: boolean };
				deviceAuthorizePath: string | null;
				deviceTokenPath: string | null;
			};
			expect(body.modes.device).toBe(false);
			expect(body.deviceAuthorizePath).toBeNull();
			expect(body.deviceTokenPath).toBeNull();
		} finally {
			h.restoreFetch();
		}
	});

	test("/auth/device/authorize proxies the IdP envelope", async () => {
		const h = await makeHarness({
			deviceAuthorizationEndpoint: DEVICE_AUTHORIZE,
			fetchHandler(url) {
				if (url === DEVICE_AUTHORIZE) {
					return new Response(
						JSON.stringify({
							device_code: "deadbeef-device-code",
							user_code: "WDJB-MJHT",
							verification_uri: "https://idp.test.example.com/activate",
							verification_uri_complete:
								"https://idp.test.example.com/activate?user_code=WDJB-MJHT",
							expires_in: 1800,
							interval: 5,
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					);
				}
				return null;
			},
		});
		try {
			const res = await h.app.request("/auth/device/authorize", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				device_code: string;
				user_code: string;
				verification_uri: string;
				verification_uri_complete?: string;
				expires_in: number;
				interval: number;
			};
			expect(body.device_code).toBe("deadbeef-device-code");
			expect(body.user_code).toBe("WDJB-MJHT");
			expect(body.verification_uri).toBe(
				"https://idp.test.example.com/activate",
			);
			expect(body.verification_uri_complete).toBe(
				"https://idp.test.example.com/activate?user_code=WDJB-MJHT",
			);
			expect(body.expires_in).toBe(1800);
			expect(body.interval).toBe(5);

			// The proxy forwarded `client_id` + `scope` to the IdP per
			// RFC 8628 §3.1.
			const call = h.calls.find((c) => c.url === DEVICE_AUTHORIZE);
			expect(call).toBeTruthy();
			const params = new URLSearchParams(call?.body ?? "");
			expect(params.get("client_id")).toBe("client-1");
			expect(params.get("scope")).toBe("openid profile email");
		} finally {
			h.restoreFetch();
		}
	});

	test("/auth/device/token proxies a successful token response", async () => {
		const h = await makeHarness({
			deviceAuthorizationEndpoint: DEVICE_AUTHORIZE,
			fetchHandler(url, body) {
				if (url === TOKEN) {
					const params = new URLSearchParams(body);
					if (
						params.get("grant_type") ===
							"urn:ietf:params:oauth:grant-type:device_code" &&
						params.get("device_code") === "deadbeef-device-code"
					) {
						return new Response(
							JSON.stringify({
								access_token: "fake.jwt.token",
								token_type: "Bearer",
								expires_in: 3600,
								refresh_token: "rt-1",
								scope: "openid profile email",
							}),
							{ status: 200, headers: { "content-type": "application/json" } },
						);
					}
				}
				return null;
			},
		});
		try {
			const res = await h.app.request("/auth/device/token", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ device_code: "deadbeef-device-code" }),
			});
			expect(res.status).toBe(200);
			const body = (await res.json()) as {
				access_token: string;
				token_type: string;
				expires_in: number;
				refresh_token?: string;
				scope?: string;
			};
			expect(body.access_token).toBe("fake.jwt.token");
			expect(body.token_type).toBe("Bearer");
			expect(body.expires_in).toBe(3600);
			expect(body.refresh_token).toBe("rt-1");
		} finally {
			h.restoreFetch();
		}
	});

	test("/auth/device/token surfaces an `authorization_pending` response as a 400 the CLI can keep polling", async () => {
		const h = await makeHarness({
			deviceAuthorizationEndpoint: DEVICE_AUTHORIZE,
			fetchHandler(url) {
				if (url === TOKEN) {
					return new Response(
						JSON.stringify({ error: "authorization_pending" }),
						{ status: 400, headers: { "content-type": "application/json" } },
					);
				}
				return null;
			},
		});
		try {
			const res = await h.app.request("/auth/device/token", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ device_code: "deadbeef-device-code" }),
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("authorization_pending");
		} finally {
			h.restoreFetch();
		}
	});

	test("/auth/device/token surfaces a terminal error verbatim", async () => {
		const h = await makeHarness({
			deviceAuthorizationEndpoint: DEVICE_AUTHORIZE,
			fetchHandler(url) {
				if (url === TOKEN) {
					return new Response(JSON.stringify({ error: "expired_token" }), {
						status: 400,
						headers: { "content-type": "application/json" },
					});
				}
				return null;
			},
		});
		try {
			const res = await h.app.request("/auth/device/token", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ device_code: "deadbeef-device-code" }),
			});
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe("expired_token");
		} finally {
			h.restoreFetch();
		}
	});

	test("device routes respond 501 device_flow_not_supported when the IdP doesn't advertise the endpoint", async () => {
		const h = await makeHarness({ deviceAuthorizationEndpoint: null });
		try {
			const authorize = await h.app.request("/auth/device/authorize", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(authorize.status).toBe(501);
			const aBody = (await authorize.json()) as { error: { code: string } };
			expect(aBody.error.code).toBe("device_flow_not_supported");

			const token = await h.app.request("/auth/device/token", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ device_code: "anything" }),
			});
			expect(token.status).toBe(501);
			const tBody = (await token.json()) as { error: { code: string } };
			expect(tBody.error.code).toBe("device_flow_not_supported");
		} finally {
			h.restoreFetch();
		}
	});

	test("/auth/device/token validates the request body", async () => {
		const h = await makeHarness({
			deviceAuthorizationEndpoint: DEVICE_AUTHORIZE,
		});
		try {
			const missingBody = await h.app.request("/auth/device/token", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({}),
			});
			expect(missingBody.status).toBe(400);
			const body = (await missingBody.json()) as { error: { code: string } };
			expect(body.error.code).toBe("invalid_request");
		} finally {
			h.restoreFetch();
		}
	});
});
