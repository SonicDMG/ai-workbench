import { describe, expect, test } from "vitest";
import { resolveJwksUri } from "../../../src/auth/oidc/jwks.js";

function mockFetch(map: Record<string, Response | (() => Response)>) {
	return async (input: string | URL): Promise<Response> => {
		const url = typeof input === "string" ? input : input.toString();
		const entry = map[url];
		if (!entry) return new Response("not found", { status: 404 });
		return typeof entry === "function" ? entry() : entry;
	};
}

describe("resolveJwksUri", () => {
	test("returns configuredUri verbatim when set", async () => {
		const uri = await resolveJwksUri({
			issuer: "https://idp.example.com",
			configuredUri: "https://keys.example.com/jwks.json",
			fetchImpl: mockFetch({}),
		});
		expect(uri).toBe("https://keys.example.com/jwks.json");
	});

	test("fetches discovery document when no uri is configured", async () => {
		const uri = await resolveJwksUri({
			issuer: "https://idp.example.com",
			configuredUri: null,
			fetchImpl: mockFetch({
				"https://idp.example.com/.well-known/openid-configuration":
					new Response(
						JSON.stringify({
							issuer: "https://idp.example.com",
							jwks_uri: "https://idp.example.com/jwks",
						}),
						{ status: 200, headers: { "content-type": "application/json" } },
					),
			}),
		});
		expect(uri).toBe("https://idp.example.com/jwks");
	});

	test("strips a trailing slash on the issuer before joining discovery path", async () => {
		const uri = await resolveJwksUri({
			issuer: "https://idp.example.com/",
			configuredUri: null,
			fetchImpl: mockFetch({
				"https://idp.example.com/.well-known/openid-configuration":
					new Response(
						JSON.stringify({ jwks_uri: "https://idp.example.com/jwks" }),
						{ status: 200 },
					),
			}),
		});
		expect(uri).toBe("https://idp.example.com/jwks");
	});

	test("throws when discovery returns non-2xx", async () => {
		await expect(
			resolveJwksUri({
				issuer: "https://idp.example.com",
				configuredUri: null,
				fetchImpl: mockFetch({}),
			}),
		).rejects.toThrow(/404/);
	});

	test("throws when discovery document lacks jwks_uri", async () => {
		await expect(
			resolveJwksUri({
				issuer: "https://idp.example.com",
				configuredUri: null,
				fetchImpl: mockFetch({
					"https://idp.example.com/.well-known/openid-configuration":
						new Response(
							JSON.stringify({ issuer: "https://idp.example.com" }),
							{
								status: 200,
							},
						),
				}),
			}),
		).rejects.toThrow(/jwks_uri/);
	});
});
