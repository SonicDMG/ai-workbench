import { describe, expect, test } from "vitest";
import {
	CreateChunkingServiceInputSchema,
	CreateEmbeddingServiceInputSchema,
	CreateLlmServiceInputSchema,
	CreateRerankingServiceInputSchema,
	EndpointBaseUrlSchema,
	EndpointPathSchema,
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
