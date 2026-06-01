import { afterEach, describe, expect, test } from "vitest";
import {
	CreateChunkingServiceInputSchema,
	CreateEmbeddingServiceInputSchema,
	CreateLlmServiceInputSchema,
	CreateRerankingServiceInputSchema,
	EndpointBaseUrlSchema,
	EndpointPathSchema,
	type HostResolver,
	resolvedEndpointSsrfReason,
	setEndpointEgressPolicy,
} from "../src/openapi/schemas.js";

describe("EndpointBaseUrlSchema", () => {
	test.each([
		["https://api.openai.com", true],
		["http://localhost:11434", true],
		["http://127.0.0.1:8080", true],
		["http://10.0.0.5:8080", true], // RFC1918 deliberately allowed (local dev)
		["https://embed.example.com:8443/v1", true],
	])("accepts %s", (value, expected) => {
		expect(EndpointBaseUrlSchema.safeParse(value).success).toBe(expected);
	});

	test.each([
		// AWS / GCP / Azure metadata services (IMDS-class SSRF)
		["http://169.254.169.254/latest/meta-data/", false],
		["http://metadata.google.internal/computeMetadata/v1/", false],
		["http://metadata.goog/", false],
		["http://metadata.azure.com/", false],
		// Link-local IPv4 generally
		["http://169.254.1.1", false],
		// Link-local IPv6
		["http://[fe80::1]/", false],
		// IPv6-mapped IPv4 IMDS — both hex and dotted forms.
		// Node normalizes the URL hostname so the literal-string and
		// v4-prefix checks miss these without explicit decoding.
		["http://[::ffff:169.254.169.254]/latest/meta-data/", false],
		["http://[::ffff:a9fe:a9fe]/latest/meta-data/", false],
		// IPv6-mapped link-local v4 generally
		["http://[::ffff:169.254.1.1]/", false],
		// Disallowed protocols
		["file:///etc/passwd", false],
		["javascript:alert(1)", false],
		["gopher://evil/", false],
		// Embedded credentials in the URL
		["https://user:pass@api.example.com/", false],
		// Unparseable
		["not a url", false],
		["", false],
	])("rejects %s", (value) => {
		expect(EndpointBaseUrlSchema.safeParse(value).success).toBe(false);
	});

	test("blocks IMDS host case-insensitively", () => {
		expect(
			EndpointBaseUrlSchema.safeParse("http://Metadata.Google.Internal/")
				.success,
		).toBe(false);
	});

	test("blocks IPv6-mapped IPv4 IMDS regardless of hex case", () => {
		expect(
			EndpointBaseUrlSchema.safeParse("http://[::FFFF:A9FE:A9FE]/").success,
		).toBe(false);
	});
});

describe("EndpointPathSchema", () => {
	test.each([
		["/v1/embeddings", true],
		["/", true],
		["/api/v1/chat/completions", true],
		["/path-with_chars.json", true],
	])("accepts %s", (value, expected) => {
		expect(EndpointPathSchema.safeParse(value).success).toBe(expected);
	});

	test.each([
		// Missing leading slash
		["v1/embeddings", false],
		// Path traversal
		["/../etc/passwd", false],
		["/v1/../../admin", false],
		// Embedded control characters / line breaks (CRLF injection vector)
		["/v1\r\nHost: evil.com", false],
		["/v1\x00null", false],
		["/v1\x7fdel", false],
	])("rejects %s", (value) => {
		expect(EndpointPathSchema.safeParse(value).success).toBe(false);
	});
});

describe("Service input schemas reject SSRF-class endpointBaseUrl values", () => {
	const baseChunking = {
		name: "ch",
		engine: "recursive",
	};
	const baseEmbedding = {
		name: "em",
		provider: "openai",
		modelName: "text-embedding-3-small",
		embeddingDimension: 1536,
	};
	const baseReranking = {
		name: "re",
		provider: "cohere",
		modelName: "rerank-3",
	};
	const baseLlm = {
		name: "ll",
		provider: "openai",
		modelName: "gpt-4o-mini",
	};

	test("CreateChunkingServiceInput rejects metadata host", () => {
		const result = CreateChunkingServiceInputSchema.safeParse({
			...baseChunking,
			endpointBaseUrl: "http://169.254.169.254/",
		});
		expect(result.success).toBe(false);
	});

	test("CreateEmbeddingServiceInput rejects metadata host", () => {
		const result = CreateEmbeddingServiceInputSchema.safeParse({
			...baseEmbedding,
			endpointBaseUrl: "http://metadata.google.internal/",
		});
		expect(result.success).toBe(false);
	});

	test("CreateRerankingServiceInput rejects metadata host", () => {
		const result = CreateRerankingServiceInputSchema.safeParse({
			...baseReranking,
			endpointBaseUrl: "http://169.254.169.254/",
		});
		expect(result.success).toBe(false);
	});

	test("CreateLlmServiceInput rejects metadata host", () => {
		const result = CreateLlmServiceInputSchema.safeParse({
			...baseLlm,
			endpointBaseUrl: "http://metadata.azure.com/",
		});
		expect(result.success).toBe(false);
	});

	test("CreateEmbeddingServiceInput rejects path traversal in endpointPath", () => {
		const result = CreateEmbeddingServiceInputSchema.safeParse({
			...baseEmbedding,
			endpointBaseUrl: "https://api.openai.com",
			endpointPath: "/v1/../admin",
		});
		expect(result.success).toBe(false);
	});

	test("CreateEmbeddingServiceInput accepts valid public endpoint", () => {
		const result = CreateEmbeddingServiceInputSchema.safeParse({
			...baseEmbedding,
			endpointBaseUrl: "https://api.openai.com",
			endpointPath: "/v1/embeddings",
		});
		expect(result.success).toBe(true);
	});

	test("CreateEmbeddingServiceInput allows null endpoint (provider default)", () => {
		const result = CreateEmbeddingServiceInputSchema.safeParse({
			...baseEmbedding,
			endpointBaseUrl: null,
			endpointPath: null,
		});
		expect(result.success).toBe(true);
	});
});

describe("resolvedEndpointSsrfReason — DNS-resolution guard", () => {
	// Default egress policy allows private networks (dev). Restore it after
	// any test that locks the policy down so the suite stays order-independent.
	afterEach(() => setEndpointEgressPolicy({ blockPrivateNetworks: false }));

	const resolvesTo =
		(...addresses: { address: string; family: number }[]): HostResolver =>
		async () =>
			addresses;

	test("allows a host that resolves only to public addresses", async () => {
		const reason = await resolvedEndpointSsrfReason(
			"https://tools.example.com/mcp",
			resolvesTo({ address: "93.184.216.34", family: 4 }),
		);
		expect(reason).toBeNull();
	});

	test("blocks a benign-looking host that resolves to the cloud-metadata IP", async () => {
		const reason = await resolvedEndpointSsrfReason(
			"https://innocent.example.com/mcp",
			resolvesTo({ address: "169.254.169.254", family: 4 }),
		);
		expect(reason).toMatch(
			/resolves to a blocked address \(169\.254\.169\.254\)/,
		);
	});

	test("blocks when ANY resolved address is internal (DNS round-robin rebind)", async () => {
		const reason = await resolvedEndpointSsrfReason(
			"https://mixed.example.com/mcp",
			resolvesTo(
				{ address: "93.184.216.34", family: 4 },
				{ address: "169.254.169.254", family: 4 },
			),
		);
		expect(reason).toMatch(/blocked address/);
	});

	test("allows a host resolving to RFC1918 by default (on-prem dev)", async () => {
		const reason = await resolvedEndpointSsrfReason(
			"https://internal-mcp.corp/mcp",
			resolvesTo({ address: "10.0.0.5", family: 4 }),
		);
		expect(reason).toBeNull();
	});

	test("blocks a host resolving to RFC1918 once private networks are locked down", async () => {
		setEndpointEgressPolicy({ blockPrivateNetworks: true });
		const reason = await resolvedEndpointSsrfReason(
			"https://internal-mcp.corp/mcp",
			resolvesTo({ address: "10.0.0.5", family: 4 }),
		);
		expect(reason).toMatch(/resolves to a blocked address \(10\.0\.0\.5\)/);
	});

	test("blocks an IPv6 unique-local resolution when locked down", async () => {
		setEndpointEgressPolicy({ blockPrivateNetworks: true });
		const reason = await resolvedEndpointSsrfReason(
			"https://internal-v6.corp/mcp",
			resolvesTo({ address: "fd00::1", family: 6 }),
		);
		expect(reason).toMatch(/blocked address/);
	});

	test("fails closed when the host does not resolve", async () => {
		const reason = await resolvedEndpointSsrfReason(
			"https://nxdomain.example.com/mcp",
			async () => {
				throw new Error("ENOTFOUND");
			},
		);
		expect(reason).toMatch(/could not be resolved/);
	});

	test("fails closed when the host resolves to no addresses", async () => {
		const reason = await resolvedEndpointSsrfReason(
			"https://empty.example.com/mcp",
			resolvesTo(),
		);
		expect(reason).toMatch(/did not resolve to any address/);
	});

	test("rejects a literal metadata URL without consulting the resolver", async () => {
		let called = false;
		const reason = await resolvedEndpointSsrfReason(
			"http://169.254.169.254/latest/meta-data/",
			async () => {
				called = true;
				return [];
			},
		);
		expect(reason).toMatch(/not an allowed endpoint/);
		expect(called).toBe(false);
	});

	test("skips DNS resolution for a public literal IP (already range-checked)", async () => {
		let called = false;
		const reason = await resolvedEndpointSsrfReason(
			"https://93.184.216.34/mcp",
			async () => {
				called = true;
				return [];
			},
		);
		expect(reason).toBeNull();
		expect(called).toBe(false);
	});
});
