import {
	type CryptoKey,
	exportJWK,
	generateKeyPair,
	importJWK,
	type JWK,
	type JWTPayload,
	SignJWT,
} from "jose";
import { beforeAll, describe, expect, test } from "vitest";
import { UnauthorizedError } from "../../../src/auth/errors.js";
import { OidcVerifier } from "../../../src/auth/oidc/verifier.js";
import type { OidcConfig } from "../../../src/config/schema.js";

const ISSUER = "https://idp.test.example.com";
const AUDIENCE = "workbench";
const KID = "test-key-1";
const ALG = "RS256";

interface KeyFixture {
	readonly privateKey: CryptoKey;
	readonly publicJwk: JWK;
}

async function makeKeys(): Promise<KeyFixture> {
	const { publicKey, privateKey } = await generateKeyPair(ALG, {
		extractable: true,
	});
	const publicJwk = await exportJWK(publicKey);
	return { privateKey, publicJwk: { ...publicJwk, alg: ALG, kid: KID } };
}

async function signJwt(
	key: CryptoKey,
	payload: JWTPayload,
	overrides?: {
		issuer?: string;
		audience?: string | string[];
		exp?: string | number;
		nbf?: string | number;
	},
): Promise<string> {
	return await new SignJWT(payload)
		.setProtectedHeader({ alg: ALG, kid: KID })
		.setIssuedAt()
		.setIssuer(overrides?.issuer ?? ISSUER)
		.setAudience(overrides?.audience ?? AUDIENCE)
		.setExpirationTime(overrides?.exp ?? "2h")
		.setNotBefore(overrides?.nbf ?? 0)
		.sign(key);
}

function baseConfig(overrides?: Partial<OidcConfig>): OidcConfig {
	return {
		issuer: ISSUER,
		audience: AUDIENCE,
		jwksUri: null,
		clockToleranceSeconds: 30,
		claims: {
			subject: "sub",
			label: "email",
			workspaceScopes: "wb_workspace_scopes",
		},
		...overrides,
	};
}

// Build a local `getKey` that ignores protected-header `kid`/`alg`
// mismatches — we control the fixture.
async function localGetKey(jwk: JWK) {
	const key = await importJWK(jwk, ALG);
	return async () => key;
}

describe("OidcVerifier.verify", () => {
	let keys: KeyFixture;
	let getKey: Awaited<ReturnType<typeof localGetKey>>;
	beforeAll(async () => {
		keys = await makeKeys();
		getKey = await localGetKey(keys.publicJwk);
	});

	test("accepts a well-formed token and maps claims", async () => {
		const token = await signJwt(keys.privateKey, {
			sub: "user-1",
			email: "alice@example.com",
			wb_workspace_scopes: ["wa"],
		});
		const v = new OidcVerifier({ config: baseConfig(), getKey });
		const subj = await v.verify(token);
		expect(subj).toEqual({
			type: "oidc",
			id: "user-1",
			label: "alice@example.com",
			workspaceScopes: ["wa"],
		});
	});

	test("returns null for non-JWT-shaped tokens (lets apiKey verifier try)", async () => {
		const v = new OidcVerifier({ config: baseConfig(), getKey });
		expect(
			await v.verify("wb_live_abcdefghijkl_0123456789abcdef0123456789abcdef"), // secret-scan: allow
		).toBe(null);
		expect(await v.verify("not-a-jwt")).toBe(null);
		expect(await v.verify("")).toBe(null);
	});

	test("rejects tokens with the wrong issuer", async () => {
		const token = await signJwt(
			keys.privateKey,
			{ sub: "user-1" },
			{ issuer: "https://other-idp.example.com" },
		);
		const v = new OidcVerifier({ config: baseConfig(), getKey });
		await expect(v.verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
	});

	test("rejects tokens with the wrong audience", async () => {
		const token = await signJwt(
			keys.privateKey,
			{ sub: "user-1" },
			{ audience: "some-other-api" },
		);
		const v = new OidcVerifier({ config: baseConfig(), getKey });
		await expect(v.verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
	});

	test("accepts a token whose audience is one of several configured", async () => {
		const token = await signJwt(
			keys.privateKey,
			{ sub: "user-1" },
			{ audience: "internal-api" },
		);
		const v = new OidcVerifier({
			config: baseConfig({ audience: ["workbench", "internal-api"] }),
			getKey,
		});
		const subj = await v.verify(token);
		expect(subj?.id).toBe("user-1");
	});

	test("rejects expired tokens", async () => {
		const token = await signJwt(
			keys.privateKey,
			{ sub: "user-1" },
			{ exp: Math.floor(Date.now() / 1000) - 120 },
		);
		const v = new OidcVerifier({
			config: baseConfig({ clockToleranceSeconds: 0 }),
			getKey,
		});
		await expect(v.verify(token)).rejects.toMatchObject({
			message: expect.stringMatching(/expired/),
		});
	});

	test("rejects tokens missing the subject claim", async () => {
		const token = await signJwt(keys.privateKey, { email: "a@b.c" });
		const v = new OidcVerifier({ config: baseConfig(), getKey });
		await expect(v.verify(token)).rejects.toMatchObject({
			message: expect.stringMatching(/'sub' claim/),
		});
	});

	test("rejects tokens signed by a different key", async () => {
		const otherKeys = await makeKeys();
		const token = await signJwt(otherKeys.privateKey, { sub: "user-1" });
		const v = new OidcVerifier({ config: baseConfig(), getKey });
		await expect(v.verify(token)).rejects.toBeInstanceOf(UnauthorizedError);
	});
});
