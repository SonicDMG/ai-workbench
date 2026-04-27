/**
 * End-to-end checks through the real app.
 *
 *   - `mode: oidc` accepts valid JWTs and rejects everything else.
 *   - `mode: any` accepts both apiKey + JWT, in that order, on the
 *     same app instance.
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
import { createApp } from "../../../src/app.js";
import { ApiKeyVerifier } from "../../../src/auth/apiKey/verifier.js";
import { OidcVerifier } from "../../../src/auth/oidc/verifier.js";
import { AuthResolver } from "../../../src/auth/resolver.js";
import type { OidcConfig } from "../../../src/config/schema.js";
import { MemoryControlPlaneStore } from "../../../src/control-plane/memory/store.js";
import { MockVectorStoreDriver } from "../../../src/drivers/mock/store.js";
import { VectorStoreDriverRegistry } from "../../../src/drivers/registry.js";
import { EnvSecretProvider } from "../../../src/secrets/env.js";
import { SecretResolver } from "../../../src/secrets/provider.js";
import { makeFakeEmbedderFactory } from "../../helpers/embedder.js";

const ISSUER = "https://idp.test.example.com";
const AUD = "workbench";
const ALG = "RS256";
const KID = "kid-1";

function oidcConfig(): OidcConfig {
	return {
		issuer: ISSUER,
		audience: AUD,
		jwksUri: null,
		clockToleranceSeconds: 30,
		claims: {
			subject: "sub",
			label: "email",
			workspaceScopes: "wb_workspace_scopes",
		},
	};
}

async function makeFixture() {
	const { publicKey, privateKey } = await generateKeyPair(ALG, {
		extractable: true,
	});
	const publicJwk: JWK = {
		...(await exportJWK(publicKey)),
		alg: ALG,
		kid: KID,
	};
	const imported = await importJWK(publicJwk, ALG);
	const getKey = async () => imported;
	return { privateKey, getKey };
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

describe("app with auth.mode: oidc", () => {
	let privateKey: CryptoKey;
	let getKey: () => Promise<Awaited<ReturnType<typeof importJWK>>>;
	beforeAll(async () => {
		const f = await makeFixture();
		privateKey = f.privateKey;
		getKey = f.getKey;
	});

	test("valid JWT authenticates and authz filters to claimed scopes", async () => {
		const store = new MemoryControlPlaneStore();
		const w1 = await store.createWorkspace({ name: "w1", kind: "mock" });
		const w2 = await store.createWorkspace({ name: "w2", kind: "mock" });
		const drivers = new VectorStoreDriverRegistry(
			new Map([["mock", new MockVectorStoreDriver()]]),
		);
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		const auth = new AuthResolver({
			mode: "oidc",
			anonymousPolicy: "reject",
			verifiers: [new OidcVerifier({ config: oidcConfig(), getKey })],
		});
		const app = createApp({
			store,
			drivers,
			secrets,
			auth,
			embedders: makeFakeEmbedderFactory(),
		});

		const token = await mintJwt(privateKey, {
			sub: "alice",
			scopes: [w1.uid],
		});
		const bearer = { authorization: `Bearer ${token}` };

		expect(
			(await app.request(`/api/v1/workspaces/${w1.uid}`, { headers: bearer }))
				.status,
		).toBe(200);
		expect(
			(await app.request(`/api/v1/workspaces/${w2.uid}`, { headers: bearer }))
				.status,
		).toBe(403);

		const listRes = await app.request("/api/v1/workspaces", {
			headers: bearer,
		});
		const body = (await listRes.json()) as {
			items: Array<{ workspaceId: string }>;
		};
		expect(body.items.map((w) => w.workspaceId)).toEqual([w1.uid]);
	});

	test("missing token + anonymousPolicy: reject → 401", async () => {
		const store = new MemoryControlPlaneStore();
		await store.createWorkspace({ name: "w", kind: "mock" });
		const drivers = new VectorStoreDriverRegistry(new Map());
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });
		const auth = new AuthResolver({
			mode: "oidc",
			anonymousPolicy: "reject",
			verifiers: [new OidcVerifier({ config: oidcConfig(), getKey })],
		});
		const app = createApp({
			store,
			drivers,
			secrets,
			auth,
			embedders: makeFakeEmbedderFactory(),
		});
		const res = await app.request("/api/v1/workspaces");
		expect(res.status).toBe(401);
	});
});

describe("app with auth.mode: any (apiKey + oidc)", () => {
	test("accepts both an apiKey and a JWT on the same app", async () => {
		const store = new MemoryControlPlaneStore();
		const ws = await store.createWorkspace({ name: "w", kind: "mock" });
		const drivers = new VectorStoreDriverRegistry(
			new Map([["mock", new MockVectorStoreDriver()]]),
		);
		const secrets = new SecretResolver({ env: new EnvSecretProvider() });

		const { privateKey, getKey } = await makeFixture();
		const auth = new AuthResolver({
			mode: "any",
			anonymousPolicy: "reject",
			// Order matters: apiKey first (its parseToken returns null for
			// JWTs so they fall through), oidc second (its shape regex
			// returns null for wb_live_* tokens).
			verifiers: [
				new ApiKeyVerifier({ store }),
				new OidcVerifier({ config: oidcConfig(), getKey }),
			],
		});
		const app = createApp({
			store,
			drivers,
			secrets,
			auth,
			embedders: makeFakeEmbedderFactory(),
		});

		// Issue an API key via the public route using a JWT-authed
		// operator — proves oidc works end-to-end.
		const adminJwt = await mintJwt(privateKey, {
			sub: "admin",
			scopes: [ws.uid],
		});
		const create = await app.request(`/api/v1/workspaces/${ws.uid}/api-keys`, {
			method: "POST",
			headers: {
				authorization: `Bearer ${adminJwt}`,
				"content-type": "application/json",
			},
			body: JSON.stringify({ label: "ci" }),
		});
		expect(create.status).toBe(201);
		const created = (await create.json()) as { plaintext: string };

		// Then use the API key to fetch workspace detail — proves
		// apiKey verifier still works with oidc registered.
		const apiKeyRes = await app.request(`/api/v1/workspaces/${ws.uid}`, {
			headers: { authorization: `Bearer ${created.plaintext}` },
		});
		expect(apiKeyRes.status).toBe(200);
	});
});
