/**
 * Shared Zod + OpenAPI schemas for the AI Workbench HTTP surface.
 *
 * Every response / request body reaches the wire through one of these.
 * Keeping them in a single module means the generated OpenAPI doc at
 * `/api/v1/openapi.json` stays coherent — field names are declared
 * once, referenced everywhere.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "@hono/zod-openapi";
import { ALL_API_KEY_SCOPES } from "../control-plane/types.js";
import {
	MAX_AGENT_DESCRIPTION_CHARS,
	MAX_AGENT_NAME_CHARS,
	MAX_AGENT_PROMPT_CHARS,
	MAX_CHAT_MESSAGE_CHARS,
	MAX_INGEST_TEXT_CHARS,
	MAX_QUERY_TEXT_CHARS,
	MAX_VECTOR_RECORD_TEXT_CHARS,
	MAX_VECTOR_VALUES,
} from "../lib/limits.js";
import { MAX_PAGE_LIMIT } from "../lib/pagination.js";

/* ---------------- Service endpoint validators ---------------- */

/**
 * Hostnames that resolve to cloud-provider instance metadata services.
 * Allowing user-configured embedding/reranking/LLM endpoints to point
 * at these would expose IAM credentials to anyone who can call the
 * runtime — IMDSv1 on AWS in particular is a single GET away from
 * leaking the EC2 role's STS keys. We block by hostname *and* by
 * link-local IP range so neither `http://169.254.169.254/...` nor
 * `http://metadata.google.internal/...` parses as a valid endpoint.
 *
 * RFC1918 ranges (10.x, 172.16/12, 192.168) and loopback are
 * conditionally blocked via `setEndpointEgressPolicy` — they default to
 * allowed so the dominant dev workflow (local Ollama / vLLM at
 * `http://localhost:11434`) keeps working, but the runtime auto-flips
 * the block on when `runtime.environment === "production"` and the
 * operator can also opt in via `runtime.blockPrivateNetworkEndpoints`.
 * This is a layered defense; production deployments should still add
 * network egress controls at the infrastructure layer.
 */
const BLOCKED_ENDPOINT_HOSTS = new Set([
	"metadata.google.internal",
	"metadata.goog",
	"metadata.azure.com",
	"169.254.169.254",
	"fd00:ec2::254",
]);

/** Link-local v4 (`169.254.x.x`) covers the IMDS family across clouds. */
const LINK_LOCAL_V4 = /^169\.254\./;
/** Link-local v6 (`fe80::/10`). */
const LINK_LOCAL_V6 = /^\[?fe[89ab][0-9a-f]?:/i;
/** Loopback v4. */
const LOOPBACK_V4 = /^127\./;
/** RFC1918 10.0.0.0/8. */
const RFC1918_10 = /^10\./;
/** RFC1918 192.168.0.0/16. */
const RFC1918_192 = /^192\.168\./;

/** RFC1918 172.16.0.0/12 — needs a numeric check for the second octet. */
function isRfc1918_172(host: string): boolean {
	const m = host.match(/^172\.(\d+)\./);
	if (!m) return false;
	const second = Number.parseInt(m[1] as string, 10);
	return second >= 16 && second <= 31;
}

/**
 * IPv6-mapped IPv4 (`::ffff:0:0/96`). Node's `URL` keeps this in the
 * `[::ffff:a9fe:a9fe]` shape — same address as `169.254.169.254` but
 * a literal-string compare against {@link BLOCKED_ENDPOINT_HOSTS} or
 * {@link LINK_LOCAL_V4} misses it. Decode to dotted-quad and re-run
 * the v4 checks. Matches both hex (`::ffff:a9fe:a9fe`) and mixed
 * (`::ffff:169.254.169.254`) forms.
 */
const IPV6_MAPPED_V4_HEX = /^\[?::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})\]?$/i;
const IPV6_MAPPED_V4_DOTTED =
	/^\[?::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\]?$/i;

function decodeIpv6MappedV4(host: string): string | null {
	const dotted = host.match(IPV6_MAPPED_V4_DOTTED);
	if (dotted) return dotted[1] as string;
	const hex = host.match(IPV6_MAPPED_V4_HEX);
	if (!hex) return null;
	const hi = Number.parseInt(hex[1] as string, 16);
	const lo = Number.parseInt(hex[2] as string, 16);
	if (!Number.isFinite(hi) || !Number.isFinite(lo)) return null;
	return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * Egress policy applied by `EndpointBaseUrlSchema`. Mutable so
 * `loadConfig` can flip the private-network block at boot without
 * threading the policy through every schema parse site.
 *
 * Defaults preserve the dev workflow (private networks allowed).
 * `runtime.environment === "production"` forces `blockPrivateNetworks:
 * true`; operators can also opt in via
 * `runtime.blockPrivateNetworkEndpoints`.
 */
const endpointEgressPolicy: { blockPrivateNetworks: boolean } = {
	blockPrivateNetworks: false,
};

export function setEndpointEgressPolicy(
	policy: Readonly<{ blockPrivateNetworks: boolean }>,
): void {
	endpointEgressPolicy.blockPrivateNetworks = policy.blockPrivateNetworks;
}

function isPrivateNetworkHost(host: string): boolean {
	if (host === "localhost") return true;
	if (LOOPBACK_V4.test(host)) return true;
	if (host === "::1" || host === "[::1]") return true;
	if (RFC1918_10.test(host)) return true;
	if (RFC1918_192.test(host)) return true;
	if (isRfc1918_172(host)) return true;
	// IPv6 unique-local addresses (fc00::/7).
	if (/^\[?f[cd][0-9a-f]{2}:/i.test(host)) return true;
	return false;
}

function isAllowedEndpointBaseUrl(value: string): boolean {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return false;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") {
		return false;
	}
	if (url.username || url.password) {
		return false;
	}
	const host = url.hostname.toLowerCase();
	if (host === "") return false;
	if (BLOCKED_ENDPOINT_HOSTS.has(host)) return false;
	if (LINK_LOCAL_V4.test(host)) return false;
	if (LINK_LOCAL_V6.test(host)) return false;

	// IPv6-mapped IPv4 (e.g. `[::ffff:169.254.169.254]`) bypasses the
	// literal-string and v4-prefix checks above. Decode to dotted-quad
	// and re-run the v4-class checks before deciding.
	const mapped = decodeIpv6MappedV4(host);
	if (mapped !== null) {
		if (BLOCKED_ENDPOINT_HOSTS.has(mapped)) return false;
		if (LINK_LOCAL_V4.test(mapped)) return false;
		if (
			endpointEgressPolicy.blockPrivateNetworks &&
			isPrivateNetworkHost(mapped)
		) {
			return false;
		}
	}

	if (endpointEgressPolicy.blockPrivateNetworks && isPrivateNetworkHost(host)) {
		return false;
	}
	return true;
}

/**
 * Validator for `endpointBaseUrl` on chunking / embedding / reranking
 * / llm services. Must be a parseable http(s) URL with a hostname that
 * isn't a known cloud-metadata service. Empty/null is allowed via
 * `.nullable()` at the field level — this validator only fires when a
 * value is present.
 *
 * When the egress policy is configured to block private networks, this
 * validator additionally rejects RFC1918 / loopback hosts. See
 * `setEndpointEgressPolicy`.
 */
export const EndpointBaseUrlSchema = z
	.string()
	.min(1)
	.refine(isAllowedEndpointBaseUrl, {
		message:
			"endpointBaseUrl must be an http(s) URL; cloud-metadata and link-local hosts are blocked (private networks may also be blocked depending on runtime.blockPrivateNetworkEndpoints)",
	});

/* -------- DNS-resolution SSRF guard for endpoint URLs -------- */

/** A resolved address, mirroring `dns.LookupAddress` (`{ address, family }`). */
export interface ResolvedAddress {
	readonly address: string;
	readonly family: number;
}

/**
 * Resolve a hostname to its IP addresses. Mirrors `dns.lookup(host, { all:
 * true })` — the resolver `fetch` itself uses — so what we validate is what
 * the connection will target. Overridable in tests.
 */
export type HostResolver = (
	hostname: string,
) => Promise<readonly ResolvedAddress[]>;

const defaultEndpointHostResolver: HostResolver = (hostname) =>
	dnsLookup(hostname, { all: true });

/**
 * Full pre-flight host check for an endpoint URL: the synchronous literal
 * checks of {@link EndpointBaseUrlSchema} PLUS — for DNS names — resolution
 * and re-validation of every resolved address. Closes the "a public-looking
 * hostname that resolves to 169.254.169.254 / a private IP slips past the
 * literal check" SSRF hole that the literal validator alone can't see.
 *
 * It re-runs {@link isAllowedEndpointBaseUrl} on a synthetic URL per resolved
 * IP, so it stays in lockstep with the literal policy AND honors
 * {@link setEndpointEgressPolicy}: cloud-metadata / link-local addresses are
 * always refused, while RFC1918 / loopback are refused only when
 * `blockPrivateNetworks` is on — so an on-prem operator can still register an
 * MCP server on an internal host in a dev/un-locked-down deployment.
 *
 * Fails closed: a host that won't resolve, resolves to nothing, or resolves
 * to ANY blocked address is refused. Returns a reason string when the URL
 * must be refused, else `null`.
 *
 * Residual: a sub-second DNS rebind between this check and the actual
 * connection remains possible; `safeFetch`'s `redirect: "error"` bounds it.
 */
export async function resolvedEndpointSsrfReason(
	rawUrl: string,
	resolveHost: HostResolver = defaultEndpointHostResolver,
): Promise<string | null> {
	if (!isAllowedEndpointBaseUrl(rawUrl)) {
		return "URL is not an allowed endpoint (http(s) only; cloud-metadata, link-local, and — when locked down — private hosts are blocked)";
	}
	// isAllowedEndpointBaseUrl accepted it, so this parse succeeds.
	const host = new URL(rawUrl).hostname.toLowerCase();
	const literal =
		host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
	// A literal IP was already range-checked synchronously above.
	if (isIP(literal) !== 0) return null;

	let addresses: readonly ResolvedAddress[];
	try {
		addresses = await resolveHost(host);
	} catch {
		return `host '${host}' could not be resolved`;
	}
	if (addresses.length === 0) {
		return `host '${host}' did not resolve to any address`;
	}
	for (const { address, family } of addresses) {
		// Re-run the literal policy against the resolved IP by synthesizing a
		// URL for it; this reuses the exact metadata / link-local / private
		// range checks (and the egress toggle) the literal validator applies.
		const synthetic =
			family === 6 ? `https://[${address}]/` : `https://${address}/`;
		if (!isAllowedEndpointBaseUrl(synthetic)) {
			return `host '${host}' resolves to a blocked address (${address})`;
		}
	}
	return null;
}

/**
 * Validator for the `endpointPath` suffix appended to
 * `endpointBaseUrl` at request time. Leading-slash required so
 * `joinUrl` produces a deterministic absolute URL; `..` segments and
 * control characters are rejected to prevent path traversal back up
 * the URL hierarchy or smuggling line breaks into outbound HTTP.
 */
export const EndpointPathSchema = z
	.string()
	.min(1)
	.refine(
		(value) => {
			if (!value.startsWith("/")) return false;
			if (value.includes("..")) return false;
			// biome-ignore lint/suspicious/noControlCharactersInRegex: explicit reject
			if (/[\x00-\x1f\x7f]/.test(value)) return false;
			return true;
		},
		{
			message:
				"endpointPath must start with '/' and contain no '..' or control characters",
		},
	);

/* ---------------- Operational ---------------- */

export const BannerSchema = z
	.object({
		name: z.string().openapi({ example: "ai-workbench" }),
		version: z.string().openapi({ example: "0.0.0" }),
		commit: z.string().openapi({ example: "abc1234" }),
		docs: z.string().openapi({ example: "/docs" }),
	})
	.openapi("Banner");

export const HealthSchema = z
	.object({ status: z.literal("ok") })
	.openapi("Health");

export const ReadySchema = z
	.object({
		status: z.literal("ready"),
		workspaces: z.number().int().openapi({ example: 3 }),
		ingest: z
			.object({
				active: z.number().int().openapi({ example: 1 }),
				capacity: z.number().int().openapi({ example: 4 }),
				queued: z.number().int().openapi({ example: 0 }),
			})
			.openapi("ReadyIngestStats")
			.optional(),
	})
	.openapi("Ready");

export const VersionSchema = z
	.object({
		version: z.string().openapi({ example: "0.0.0" }),
		commit: z.string().openapi({ example: "abc1234" }),
		buildTime: z
			.string()
			.datetime()
			.openapi({ example: "2026-04-21T10:30:00Z" }),
		node: z.string().openapi({ example: "v22.11.0" }),
	})
	.openapi("Version");

/**
 * Runtime feature flags exposed to the web UI so it can hide
 * affordances that aren't wired up server-side. Read-only — flips
 * driven by `workbench.yaml` at startup. `mcp.baseUrl` is computed
 * per-request from the inbound URL / `Forwarded` headers so MCP
 * clients running outside the browser (Claude Code, Cursor) get a
 * URL that bypasses the Vite dev proxy / TLS-terminating LB.
 */
export const FeaturesSchema = z
	.object({
		mcp: z.object({
			enabled: z.boolean().openapi({ example: false }),
			baseUrl: z
				.string()
				.url()
				.nullable()
				.openapi({ example: "http://localhost:8080" }),
		}),
	})
	.openapi("Features");

/**
 * Public shape of `astra-cli` auto-detection at runtime startup.
 * Whether the runtime resolved a profile/database from the `astra`
 * CLI, and which one. The token is never exposed on the wire — the
 * UI uses this to suggest sensible defaults in the workspace
 * onboarding form, and to confirm to the user that the env vars
 * they're about to use point at a real database.
 */
export const AstraCliDatabaseInfoSchema = z
	.object({
		id: z.string().openapi({ example: "00000000-0000-0000-0000-000000000000" }),
		name: z.string().openapi({ example: "mydb" }),
		region: z.string().openapi({ example: "us-east-2" }),
		endpoint: z.string().url().openapi({
			example:
				"https://00000000-0000-0000-0000-000000000000-us-east-2.apps.astra.datastax.com",
		}),
		keyspace: z.string().nullable().openapi({ example: "default_keyspace" }),
	})
	.openapi("AstraCliDatabaseInfo");

export const AstraCliInfoSchema = z
	.discriminatedUnion("detected", [
		z.object({
			detected: z.literal(true),
			profile: z.string().openapi({ example: "workbench-dev" }),
			database: AstraCliDatabaseInfoSchema,
		}),
		z.object({
			detected: z.literal(false),
			reason: z.enum([
				"already-configured",
				"disabled",
				"binary-not-found",
				"no-profiles",
				"no-databases",
				"ambiguous-profile-non-interactive",
				"ambiguous-database-non-interactive",
				"user-aborted",
				"cli-error",
			]),
		}),
	])
	.openapi("AstraCliInfo");

/**
 * Full astra-cli inventory: every configured profile with the
 * databases it can see, token-redacted. Drives the workspace
 * onboarding picker so the user can choose a profile + database in
 * the UI rather than restarting the runtime with `ASTRA_PROFILE=…`.
 *
 * `available: false` cases mirror the reasons enum used by
 * `AstraCliInfoSchema` so the UI can share rendering code.
 */
export const AstraCliProfileEntrySchema = z
	.object({
		name: z.string().openapi({ example: "workbench-dev" }),
		env: z.string().openapi({ example: "PROD" }),
		isUsedAsDefault: z.boolean().openapi({ example: false }),
		databases: z.array(AstraCliDatabaseInfoSchema),
	})
	.openapi("AstraCliProfileEntry");

export const AstraCliInventorySchema = z
	.discriminatedUnion("available", [
		z.object({
			available: z.literal(true),
			profiles: z.array(AstraCliProfileEntrySchema),
		}),
		z.object({
			available: z.literal(false),
			reason: z.enum([
				"already-configured",
				"disabled",
				"binary-not-found",
				"no-profiles",
				"no-databases",
				"ambiguous-profile-non-interactive",
				"ambiguous-database-non-interactive",
				"user-aborted",
				"cli-error",
			]),
		}),
	])
	.openapi("AstraCliInventory");

/* ---------------- Errors ---------------- */

export const ErrorEnvelopeSchema = z
	.object({
		error: z.object({
			code: z.string().openapi({ example: "workspace_not_found" }),
			message: z.string(),
			requestId: z.string().openapi({ example: "01HY2Z..." }),
			hint: z.string().optional().openapi({
				example:
					"The workspace does not exist or your principal cannot see it; run `aiw workspace list` to verify.",
				description:
					"One-line remediation paired with this code in the runtime's error registry. Present whenever the code is registered.",
			}),
			docs: z.string().optional().openapi({
				example: "docs/errors.md#workspace-not-found",
				description:
					"Relative path (under the docs root) to the long-form explanation of this code. Present whenever the code is registered.",
			}),
		}),
	})
	.openapi("ErrorEnvelope");

/* ---------------- Pagination ---------------- */

export const PaginationQuerySchema = z
	.object({
		limit: z.coerce
			.number()
			.int()
			.min(1)
			.max(MAX_PAGE_LIMIT)
			.optional()
			.openapi({
				param: { name: "limit", in: "query" },
				example: 50,
				description: `Maximum number of items to return (max ${MAX_PAGE_LIMIT}).`,
			}),
		cursor: z
			.string()
			.min(1)
			.optional()
			.openapi({
				param: { name: "cursor", in: "query" },
				description:
					"Opaque cursor returned as `nextCursor` from the previous page.",
			}),
	})
	.openapi("PaginationQuery");

function pageSchema<T extends z.ZodTypeAny>(name: string, item: T) {
	return z
		.object({
			items: z.array(item),
			nextCursor: z.string().nullable(),
		})
		.openapi(name);
}

/* ---------------- Enums ---------------- */

const WorkspaceKind = z.enum(["astra", "hcd", "openrag", "mock"]);

/**
 * `<provider>:<path>` — e.g. `env:OPENAI_API_KEY`, `file:/etc/secret`.
 *
 * The provider portion follows RFC 3986 URI-scheme syntax: lowercase
 * letter followed by lowercase letters, digits, `+`, `-`, or `.`. The
 * resolver always splits on the FIRST colon, so providers like
 * `astra-cli:<profile>:<dbId>:token` are accepted (`-` in the
 * provider, further colons inside the path).
 */
const SecretRefSchema = z
	.string()
	.regex(
		/^[a-z][a-z0-9+.-]*:.+$/,
		"expected '<provider>:<path>', e.g. 'env:FOO'",
	)
	.openapi("SecretRef", { example: "env:ASTRA_DB_APPLICATION_TOKEN" });
const DateTimeSchema = z.string().datetime();
const DocumentStatusSchema = z
	.enum(["pending", "chunking", "embedding", "writing", "ready", "failed"])
	.openapi("DocumentStatus");

/* ---------------- Workspace ---------------- */

/**
 * Data-plane endpoint for a workspace. Accepts either:
 *   - a literal URL (`https://<db>-<region>.apps.astra.datastax.com`), or
 *   - a {@link SecretRef} (`env:ASTRA_DB_API_ENDPOINT`, `file:/path`).
 *
 * The astra driver detects refs by prefix-matching a registered
 * {@link SecretProvider} and resolves them at dial time.
 */
const EndpointSchema = z
	.union([z.string().url(), SecretRefSchema])
	.openapi("Endpoint", { example: "env:ASTRA_DB_API_ENDPOINT" });

export const WorkspaceRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		name: z.string(),
		url: z.string().nullable(),
		kind: WorkspaceKind,
		keyspace: z.string().nullable(),
		credentials: z.record(z.string(), SecretRefSchema).openapi({
			description:
				"Secret references only. Resolved credential values are never returned.",
		}),
		/** RLAC master switch. When true, every KB read is filtered
		 * through the canonical visibility-list predicate; when false,
		 * no row-level filtering happens anywhere in the workspace and
		 * the SPA hides every RLAC surface. */
		rlacEnabled: z.boolean(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("Workspace");

export const WorkspacePageSchema = pageSchema(
	"WorkspacePage",
	WorkspaceRecordSchema,
);

export const CreateWorkspaceInputSchema = z
	.object({
		workspaceId: z.string().uuid().optional(),
		name: z.string().min(1),
		url: EndpointSchema.nullable().optional(),
		kind: WorkspaceKind,
		keyspace: z.string().nullable().optional(),
		credentials: z.record(z.string(), SecretRefSchema).optional(),
		/** RLAC master switch. Defaults to `false`. */
		rlacEnabled: z.boolean().optional(),
	})
	.openapi("CreateWorkspaceInput");

// `kind` is intentionally excluded — a workspace's backend cannot
// change after creation. Any vector-store descriptors would point at
// the old backend's collections; switching kinds would silently orphan
// them. Delete-and-recreate if the workspace needs a different kind.
export const UpdateWorkspaceInputSchema = z
	.object({
		name: z.string().min(1).optional(),
		url: EndpointSchema.nullable().optional(),
		keyspace: z.string().nullable().optional(),
		credentials: z.record(z.string(), SecretRefSchema).optional(),
		/** RLAC master switch. */
		rlacEnabled: z.boolean().optional(),
	})
	.strict()
	.openapi("UpdateWorkspaceInput");

/* ---------------- Workspace actions ---------------- */

export const TestConnectionResponseSchema = z
	.object({
		ok: z.boolean(),
		kind: WorkspaceKind,
		details: z.string().openapi({
			example: "Astra Data API responded to listCollections.",
		}),
	})
	.openapi("TestConnectionResponse");

/* ---------------- Driver descriptor (internal — no longer wire-facing) ---------------- */

const LexicalConfigSchema = z
	.object({
		enabled: z.boolean(),
		analyzer: z.string().nullable(),
		options: z.record(z.string(), z.string()),
	})
	.openapi("LexicalConfig");

/**
 * One chunk listed under a document by
 * `GET .../knowledge-bases/{kb}/documents/{d}/chunks`. The route
 * reads raw records out of the KB's vector collection, filters by
 * `documentId`, and surfaces a flat list. Text comes from the
 * `chunkText` payload key the ingest pipeline stamps.
 */
export const DocumentChunkSchema = z
	.object({
		id: z.string(),
		chunkIndex: z.number().int().nonnegative().nullable(),
		text: z.string().nullable(),
		payload: z.record(z.string(), z.unknown()),
	})
	.openapi("DocumentChunk");

/* ---------------- KB data plane (upsert + search) ---------------- */

/**
 * Input shape for upsert. Each record carries either a `vector` OR
 * a `text` (not both, not neither). Text records trigger the same
 * server-side-or-client-side dispatch as the search route — drivers
 * that support `$vectorize` (Astra with a `service` block) take
 * them natively; others fall back to the runtime's Embedder.
 */
export const VectorRecordSchema = z
	.object({
		id: z.string().min(1),
		vector: z.array(z.number()).min(1).max(MAX_VECTOR_VALUES).optional(),
		text: z.string().min(1).max(MAX_VECTOR_RECORD_TEXT_CHARS).optional(),
		payload: z.record(z.string(), z.unknown()).optional(),
	})
	.refine((r) => (r.vector === undefined) !== (r.text === undefined), {
		message: "exactly one of 'vector' or 'text' must be provided per record",
	})
	.openapi("VectorRecord");

export const UpsertRequestSchema = z
	.object({
		records: z.array(VectorRecordSchema).min(1).max(500),
	})
	.openapi("UpsertRequest");

export const UpsertResponseSchema = z
	.object({
		upserted: z.number().int().nonnegative(),
	})
	.openapi("UpsertResponse");

export const DeleteRecordResponseSchema = z
	.object({
		deleted: z.boolean(),
	})
	.openapi("DeleteRecordResponse");

/**
 * Data-plane search input.
 *
 * Either `vector` OR `text` must be present, not both. `text`
 * triggers the driver's server-side embedding path when the
 * collection supports it (e.g. Astra `$vectorize`); otherwise the
 * runtime embeds client-side via the vector store's declared
 * `embedding` config and falls back to a vector search. The route
 * layer handles the dispatch — drivers never see both fields.
 */
export const SearchRequestSchema = z
	.object({
		vector: z.array(z.number()).min(1).max(MAX_VECTOR_VALUES).optional(),
		text: z.string().min(1).max(MAX_QUERY_TEXT_CHARS).optional(),
		topK: z.number().int().positive().max(1000).optional(),
		filter: z.record(z.string(), z.unknown()).optional(),
		includeEmbeddings: z.boolean().optional(),
		/** Opt into the hybrid (vector + lexical) lane. Default follows
		 * the bound store's `lexical.enabled` flag. Requires `text`
		 * (the lexical lane can't operate without it). */
		hybrid: z.boolean().optional(),
		/** Weight of the lexical score in the hybrid combination,
		 * `[0, 1]`. Only consulted when `hybrid: true`. Default 0.5. */
		lexicalWeight: z.number().min(0).max(1).optional(),
		/** Opt into the driver's reranker after the initial retrieval.
		 * Default follows the bound store's `reranking.enabled` flag. */
		rerank: z.boolean().optional(),
	})
	.refine((v) => (v.vector === undefined) !== (v.text === undefined), {
		message: "exactly one of 'vector' or 'text' must be provided",
	})
	.openapi("SearchRequest");

export const SearchHitSchema = z
	.object({
		id: z.string(),
		score: z.number(),
		payload: z.record(z.string(), z.unknown()).optional(),
		vector: z.array(z.number()).optional(),
	})
	.openapi("SearchHit");

/* ---------------- Ingest ---------------- */

export const IngestChunkerOptionsSchema = z
	.object({
		maxChars: z.number().int().positive().optional(),
		minChars: z.number().int().nonnegative().optional(),
		overlapChars: z.number().int().nonnegative().optional(),
	})
	.openapi("IngestChunkerOptions");

/** Lifecycle of a background job. */
export const JobStatusSchema = z
	.enum(["pending", "running", "succeeded", "failed"])
	.openapi("JobStatus");

export const JobRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		jobId: z.string().uuid(),
		kind: z.enum(["ingest"]),
		knowledgeBaseId: z.string().uuid().nullable(),
		documentId: z.string().uuid().nullable(),
		status: JobStatusSchema,
		processed: z.number().int().nonnegative(),
		total: z.number().int().nonnegative().nullable(),
		result: z.record(z.string(), z.unknown()).nullable(),
		errorMessage: z.string().nullable(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("Job");

export const JobIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "jobId", in: "path" },
		example: "00000000-0000-0000-0000-000000000000",
	});

/* ---------------- Params ---------------- */

export const WorkspaceIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "workspaceId", in: "path" },
		example: "00000000-0000-0000-0000-000000000000",
	});

export const DocumentIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "documentId", in: "path" },
		example: "00000000-0000-0000-0000-000000000000",
	});

export const RecordIdParamSchema = z
	.string()
	.min(1)
	.openapi({
		param: { name: "recordId", in: "path" },
		example: "doc-1",
	});

export const ApiKeyIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "keyId", in: "path" },
		example: "00000000-0000-0000-0000-000000000000",
	});

/* ---------------- API key ---------------- */

/**
 * Privilege scopes an API key can carry — the three coarse tiers
 * (`read` / `write` / `manage`) plus the 0.5.0 `:`-suffixed fine grants
 * (e.g. `write:ingest`). A held coarse tier is a superset of its fine
 * grants (containment, see `auth/roles.scopeGrants`), so widening this
 * enum is additive: existing clients sending the coarse tiers still
 * validate. Mirrors `ApiKeyScope` in `control-plane/types.ts`.
 */
export const ApiKeyScopeSchema = z
	.enum(ALL_API_KEY_SCOPES)
	.openapi("ApiKeyScope", {
		description:
			"API-key privilege scope. Coarse tiers are supersets of their `:`-suffixed fine grants via containment: `read` grants `read:content`/`read:chat`/`read:audit`; `write` grants `write:ingest`/`write:kb`/`write:services`/`write:agents`; `manage` grants `manage:keys`/`manage:access`/`manage:workspace`. `tools:invoke` (agent external-tool calls) stands alone. Holding a coarse tier is equivalent to holding all its fine grants, so keys minted with the coarse tiers keep working as routes refine to fine scopes.",
	});

export const ApiKeyRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		keyId: z.string().uuid(),
		prefix: z
			.string()
			.openapi({ description: "Non-secret lookup prefix of the wire token" }),
		label: z.string(),
		scopes: z.array(ApiKeyScopeSchema).openapi({
			description:
				"Privilege tiers this key carries. Existing keys minted before the scopes column existed back-compat to `['read', 'write']`.",
		}),
		createdAt: DateTimeSchema,
		lastUsedAt: DateTimeSchema.nullable(),
		revokedAt: DateTimeSchema.nullable(),
		expiresAt: DateTimeSchema.nullable(),
	})
	.openapi("ApiKey");

export const ApiKeyPageSchema = pageSchema("ApiKeyPage", ApiKeyRecordSchema);

export const CreateApiKeyInputSchema = z
	.object({
		label: z
			.string()
			.min(1, "label is required")
			.max(120, "label must be at most 120 characters"),
		expiresAt: z.string().datetime().nullable().optional(),
		scopes: z
			.array(ApiKeyScopeSchema)
			.min(1, "scopes must be a non-empty array when provided")
			.optional()
			.openapi({
				description:
					"Privilege tiers to mint. Omit to default to `['read', 'write']` — keeps callers that don't care about scopes back-compat.",
			}),
	})
	.openapi("CreateApiKeyInput");

export const CreatedApiKeyResponseSchema = z
	.object({
		/** Returned ONCE on create; never retrievable again. */
		plaintext: z.string().openapi({ example: "wb_live_abc123xyz789_…" }),
		key: ApiKeyRecordSchema,
	})
	.openapi("CreatedApiKeyResponse");

export { DocumentStatusSchema };

/* ================================================================== */
/*                                                                    */
/*  Knowledge-Base schema (issue #98) — additive in phase 1b.         */
/*                                                                    */
/*  These schemas describe the new API surface that coexists with     */
/*  the legacy `/catalogs` and `/vector-stores` endpoints. Phase 1c   */
/*  drops the legacy schemas above.                                   */
/*                                                                    */
/* ================================================================== */

const ServiceStatusSchema = z
	.enum(["active", "deprecated", "experimental"])
	.openapi("ServiceStatus");

const KnowledgeBaseStatusSchema = z
	.enum(["active", "draft", "deprecated"])
	.openapi("KnowledgeBaseStatus");

/**
 * KB names double as the underlying vector-collection name on owned
 * KBs, so the regex matches Astra Data API's collection-name rules:
 * starts with a letter, then letters/digits/underscores, max 48 chars.
 * Hyphens and dots are deliberately disallowed.
 */
const KB_NAME_REGEX = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;
const KbNameSchema = z
	.string()
	.regex(
		KB_NAME_REGEX,
		"must start with a letter and contain only letters, digits, and underscores (max 48 chars)",
	);

const DistanceMetricSchema = z
	.enum(["cosine", "dot", "euclidean"])
	.openapi("DistanceMetric");

const AuthTypeSchema = z
	.enum(["none", "api_key", "oauth2", "mTLS"])
	.openapi("AuthType");

/* ---------- Knowledge base ---------- */

export const KnowledgeBaseRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		knowledgeBaseId: z.string().uuid(),
		name: KbNameSchema,
		description: z.string().nullable(),
		status: KnowledgeBaseStatusSchema,
		embeddingServiceId: z.string().uuid(),
		chunkingServiceId: z.string().uuid(),
		rerankingServiceId: z.string().uuid().nullable(),
		language: z.string().nullable(),
		vectorCollection: z.string().nullable(),
		/** True when the runtime provisioned the underlying collection
		 * during KB creation (and therefore owns its lifecycle); false
		 * when the KB was attached to a pre-existing collection. Drives
		 * whether `DELETE` drops the collection. */
		owned: z.boolean(),
		lexical: LexicalConfigSchema,
		/** RLAC: authored SQL-subset policy predicate. Nullable for
		 * legacy KBs (and KBs created without a policy). */
		policyDsl: z.string().nullable(),
		/** RLAC: when true the route layer injects the compiled filter
		 * on every read. Defaults to false. */
		policyEnabled: z.boolean(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("KnowledgeBase");

export const KnowledgeBasePageSchema = pageSchema(
	"KnowledgeBasePage",
	KnowledgeBaseRecordSchema,
);

/* ---------- Astra Data API call snapshots ----------
 *
 * Surfaced on every API response whose handler made (or is about to
 * make) a Data API call against an Astra-kind workspace. The SPA's
 * `AstraCodeChip` consumes the array and renders runnable code in TS
 * / Python / Java / cURL. Empty array for non-Astra workspaces and
 * for routes that don't touch the data plane.
 *
 * The TypeScript source of truth lives at `src/snapshots/types.ts`;
 * this Zod block exists only so the response shape appears in the
 * generated OpenAPI doc and the web client's `api-types.generated.ts`.
 * Keep the two in lockstep — adding a new kind here without
 * extending the source-of-truth union (or vice versa) leaves the
 * `gen:types` drift guard quiet but produces malformed responses at
 * runtime.
 */

const AstraSnapshotEnvelopeShape = {
	knowledgeBaseId: z.string(),
	kbName: z.string(),
	collection: z.string(),
	keyspace: z.string().nullable(),
} as const;

const AstraVectorSearchSnapshotSchema = z
	.object({
		kind: z.literal("vector_search"),
		...AstraSnapshotEnvelopeShape,
		query: z.object({
			text: z.string(),
			topK: z.number().int().positive(),
		}),
	})
	.openapi("AstraVectorSearchSnapshot");

const AstraListChunksSnapshotSchema = z
	.object({
		kind: z.literal("list_chunks"),
		...AstraSnapshotEnvelopeShape,
		query: z.object({
			documentId: z.string(),
			limit: z.number().int().positive(),
			offset: z.number().int().nonnegative(),
		}),
	})
	.openapi("AstraListChunksSnapshot");

const AstraCreateCollectionSnapshotSchema = z
	.object({
		kind: z.literal("create_collection"),
		...AstraSnapshotEnvelopeShape,
		options: z.object({
			vectorDimension: z.number().int().positive(),
			vectorMetric: z.enum(["cosine", "dot_product", "euclidean"]),
			vectorize: z
				.object({
					provider: z.string(),
					modelName: z.string(),
				})
				.nullable(),
			lexical: z
				.object({
					enabled: z.literal(true),
					analyzer: z.string(),
				})
				.nullable(),
			rerank: z
				.object({
					enabled: z.literal(true),
					provider: z.string(),
					modelName: z.string(),
				})
				.nullable(),
		}),
	})
	.openapi("AstraCreateCollectionSnapshot");

const AstraInsertChunksSnapshotSchema = z
	.object({
		kind: z.literal("insert_chunks"),
		...AstraSnapshotEnvelopeShape,
		batch: z.object({
			documentId: z.string(),
			batchSize: z.number().int().positive(),
		}),
	})
	.openapi("AstraInsertChunksSnapshot");

const AstraDeleteByDocumentSnapshotSchema = z
	.object({
		kind: z.literal("delete_by_document"),
		...AstraSnapshotEnvelopeShape,
		filter: z.object({
			documentId: z.string(),
		}),
	})
	.openapi("AstraDeleteByDocumentSnapshot");

const AstraDeleteChunkSnapshotSchema = z
	.object({
		kind: z.literal("delete_chunk"),
		...AstraSnapshotEnvelopeShape,
		filter: z.object({
			chunkId: z.string(),
		}),
	})
	.openapi("AstraDeleteChunkSnapshot");

export const AstraQuerySnapshotSchema = z
	.discriminatedUnion("kind", [
		AstraVectorSearchSnapshotSchema,
		AstraListChunksSnapshotSchema,
		AstraCreateCollectionSnapshotSchema,
		AstraInsertChunksSnapshotSchema,
		AstraDeleteByDocumentSnapshotSchema,
		AstraDeleteChunkSnapshotSchema,
	])
	.openapi("AstraQuerySnapshot");

/**
 * Response for KB-create: the KB record plus any Data API calls the
 * runtime made on the user's behalf. Sibling `astraQueries` field is
 * additive — existing clients that ignore it keep working. Empty
 * array for attach mode and non-Astra workspaces. Ingest + delete
 * surfaces adopt the same pattern in subsequent phases.
 */
export const KnowledgeBaseCreateResponseSchema =
	KnowledgeBaseRecordSchema.extend({
		astraQueries: z.array(AstraQuerySnapshotSchema),
	}).openapi("KnowledgeBaseCreateResponse");

export const CreateKnowledgeBaseInputSchema = z
	.object({
		knowledgeBaseId: z.string().uuid().optional(),
		name: KbNameSchema,
		description: z.string().nullable().optional(),
		status: KnowledgeBaseStatusSchema.optional(),
		embeddingServiceId: z.string().uuid(),
		chunkingServiceId: z.string().uuid(),
		rerankingServiceId: z.string().uuid().nullable().optional(),
		language: z.string().nullable().optional(),
		lexical: LexicalConfigSchema.optional(),
		/** Existing data-plane collection to attach to. Required when
		 * `attach` is true, must be omitted otherwise — owned KBs derive
		 * the collection name from `name`. */
		vectorCollection: z.string().nullable().optional(),
		/** When true, bind the KB to a pre-existing data-plane collection
		 * named by `vectorCollection`. The runtime skips
		 * `createCollection` and validates the collection's vector
		 * dimension matches the embedding service. The collection is NOT
		 * dropped when the KB is later deleted. */
		attach: z.boolean().optional(),
	})
	.openapi("CreateKnowledgeBaseInput");

// `name`, `embeddingServiceId`, and `chunkingServiceId` are intentionally
// absent — `name` doubles as the underlying collection identifier on
// owned KBs and Astra collections cannot be renamed; the embedding /
// chunking services are immutable because vectors and chunks on disk
// are bound to the model that produced them.
export const UpdateKnowledgeBaseInputSchema = z
	.object({
		description: z.string().nullable().optional(),
		status: KnowledgeBaseStatusSchema.optional(),
		rerankingServiceId: z.string().uuid().nullable().optional(),
		language: z.string().nullable().optional(),
		lexical: LexicalConfigSchema.optional(),
		/** RLAC: replace the policy DSL (null clears it). */
		policyDsl: z.string().nullable().optional(),
		/** RLAC: toggle enforcement. */
		policyEnabled: z.boolean().optional(),
	})
	.strict()
	.openapi("UpdateKnowledgeBaseInput");

/**
 * One pre-existing data-plane collection a workspace's driver knows
 * about. Used by the KB-attach flow so the UI can show what's already
 * in Astra and validate compatibility before the KB row is written.
 *
 * `attached` is true when a workbench KB already binds this collection
 * — the UI uses it to mark such rows as unavailable. `vectorService`
 * mirrors Astra's `$vectorize` block: when set, the collection embeds
 * server-side and the bound embedding service must use a matching
 * provider/model.
 */
export const AdoptableCollectionSchema = z
	.object({
		name: z.string(),
		vectorDimension: z.number().int().positive(),
		vectorSimilarity: DistanceMetricSchema,
		vectorService: z
			.object({ provider: z.string(), modelName: z.string() })
			.nullable(),
		lexicalEnabled: z.boolean(),
		rerankEnabled: z.boolean(),
		attached: z.boolean(),
	})
	.openapi("AdoptableCollection");

export const AdoptableCollectionListSchema = z
	.object({ items: z.array(AdoptableCollectionSchema) })
	.openapi("AdoptableCollectionList");

/* ---------- Knowledge filter ---------- */

export const KnowledgeFilterRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		knowledgeBaseId: z.string().uuid(),
		knowledgeFilterId: z.string().uuid(),
		name: z.string(),
		description: z.string().nullable(),
		filter: z.record(z.string(), z.unknown()),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("KnowledgeFilter");

export const KnowledgeFilterPageSchema = pageSchema(
	"KnowledgeFilterPage",
	KnowledgeFilterRecordSchema,
);

export const CreateKnowledgeFilterInputSchema = z
	.object({
		knowledgeFilterId: z.string().uuid().optional(),
		name: z.string().min(1),
		description: z.string().nullable().optional(),
		filter: z.record(z.string(), z.unknown()),
	})
	.openapi("CreateKnowledgeFilterInput");

export const UpdateKnowledgeFilterInputSchema =
	CreateKnowledgeFilterInputSchema.partial()
		.omit({ knowledgeFilterId: true })
		.openapi("UpdateKnowledgeFilterInput");

/* ---------- Chunking service ---------- */

export const ChunkingServiceRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		chunkingServiceId: z.string().uuid(),
		name: z.string(),
		description: z.string().nullable(),
		status: ServiceStatusSchema,
		engine: z.string(),
		engineVersion: z.string().nullable(),
		strategy: z.string().nullable(),
		maxChunkSize: z.number().int().nullable(),
		minChunkSize: z.number().int().nullable(),
		chunkUnit: z.string().nullable(),
		overlapSize: z.number().int().nullable(),
		overlapUnit: z.string().nullable(),
		preserveStructure: z.boolean().nullable(),
		language: z.string().nullable(),
		endpointBaseUrl: z.string().nullable(),
		endpointPath: z.string().nullable(),
		requestTimeoutMs: z.number().int().nullable(),
		maxPayloadSizeKb: z.number().int().nullable(),
		authType: AuthTypeSchema,
		credentialRef: z.string().nullable(),
		enableOcr: z.boolean().nullable(),
		extractTables: z.boolean().nullable(),
		extractFigures: z.boolean().nullable(),
		readingOrder: z.string().nullable(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("ChunkingService");

export const ChunkingServicePageSchema = pageSchema(
	"ChunkingServicePage",
	ChunkingServiceRecordSchema,
);

export const CreateChunkingServiceInputSchema = z
	.object({
		chunkingServiceId: z.string().uuid().optional(),
		name: z.string().min(1),
		description: z.string().nullable().optional(),
		status: ServiceStatusSchema.optional(),
		engine: z.string().min(1),
		engineVersion: z.string().nullable().optional(),
		strategy: z.string().nullable().optional(),
		maxChunkSize: z.number().int().positive().nullable().optional(),
		minChunkSize: z.number().int().nonnegative().nullable().optional(),
		chunkUnit: z.string().nullable().optional(),
		overlapSize: z.number().int().nonnegative().nullable().optional(),
		overlapUnit: z.string().nullable().optional(),
		preserveStructure: z.boolean().nullable().optional(),
		language: z.string().nullable().optional(),
		endpointBaseUrl: EndpointBaseUrlSchema.nullable().optional(),
		endpointPath: EndpointPathSchema.nullable().optional(),
		requestTimeoutMs: z.number().int().positive().nullable().optional(),
		maxPayloadSizeKb: z.number().int().positive().nullable().optional(),
		authType: AuthTypeSchema.optional(),
		credentialRef: z.string().nullable().optional(),
		enableOcr: z.boolean().nullable().optional(),
		extractTables: z.boolean().nullable().optional(),
		extractFigures: z.boolean().nullable().optional(),
		readingOrder: z.string().nullable().optional(),
	})
	.openapi("CreateChunkingServiceInput");

export const UpdateChunkingServiceInputSchema =
	CreateChunkingServiceInputSchema.partial()
		.omit({ chunkingServiceId: true })
		.openapi("UpdateChunkingServiceInput");

/* ---------- Embedding service ---------- */

export const EmbeddingServiceRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		embeddingServiceId: z.string().uuid(),
		name: z.string(),
		description: z.string().nullable(),
		status: ServiceStatusSchema,
		provider: z.string(),
		modelName: z.string(),
		embeddingDimension: z.number().int().positive(),
		distanceMetric: DistanceMetricSchema,
		endpointBaseUrl: z.string().nullable(),
		endpointPath: z.string().nullable(),
		requestTimeoutMs: z.number().int().nullable(),
		maxBatchSize: z.number().int().nullable(),
		maxInputTokens: z.number().int().nullable(),
		authType: AuthTypeSchema,
		credentialRef: z.string().nullable(),
		supportedLanguages: z.array(z.string()),
		supportedContent: z.array(z.string()),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("EmbeddingService");

export const EmbeddingServicePageSchema = pageSchema(
	"EmbeddingServicePage",
	EmbeddingServiceRecordSchema,
);

export const CreateEmbeddingServiceInputSchema = z
	.object({
		embeddingServiceId: z.string().uuid().optional(),
		name: z.string().min(1),
		description: z.string().nullable().optional(),
		status: ServiceStatusSchema.optional(),
		provider: z.string().min(1),
		modelName: z.string().min(1),
		embeddingDimension: z.number().int().positive(),
		distanceMetric: DistanceMetricSchema.optional(),
		endpointBaseUrl: EndpointBaseUrlSchema.nullable().optional(),
		endpointPath: EndpointPathSchema.nullable().optional(),
		requestTimeoutMs: z.number().int().positive().nullable().optional(),
		maxBatchSize: z.number().int().positive().nullable().optional(),
		maxInputTokens: z.number().int().positive().nullable().optional(),
		authType: AuthTypeSchema.optional(),
		credentialRef: z.string().nullable().optional(),
		supportedLanguages: z.array(z.string()).optional(),
		supportedContent: z.array(z.string()).optional(),
	})
	.openapi("CreateEmbeddingServiceInput");

export const UpdateEmbeddingServiceInputSchema =
	CreateEmbeddingServiceInputSchema.partial()
		.omit({ embeddingServiceId: true })
		.openapi("UpdateEmbeddingServiceInput");

/* ---------- Reranking service ---------- */

export const RerankingServiceRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		rerankingServiceId: z.string().uuid(),
		name: z.string(),
		description: z.string().nullable(),
		status: ServiceStatusSchema,
		provider: z.string(),
		engine: z.string().nullable(),
		modelName: z.string(),
		modelVersion: z.string().nullable(),
		maxCandidates: z.number().int().nullable(),
		scoringStrategy: z.string().nullable(),
		scoreNormalized: z.boolean().nullable(),
		returnScores: z.boolean().nullable(),
		endpointBaseUrl: z.string().nullable(),
		endpointPath: z.string().nullable(),
		requestTimeoutMs: z.number().int().nullable(),
		maxBatchSize: z.number().int().nullable(),
		authType: AuthTypeSchema,
		credentialRef: z.string().nullable(),
		supportedLanguages: z.array(z.string()),
		supportedContent: z.array(z.string()),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("RerankingService");

export const RerankingServicePageSchema = pageSchema(
	"RerankingServicePage",
	RerankingServiceRecordSchema,
);

export const CreateRerankingServiceInputSchema = z
	.object({
		rerankingServiceId: z.string().uuid().optional(),
		name: z.string().min(1),
		description: z.string().nullable().optional(),
		status: ServiceStatusSchema.optional(),
		provider: z.string().min(1),
		engine: z.string().nullable().optional(),
		modelName: z.string().min(1),
		modelVersion: z.string().nullable().optional(),
		maxCandidates: z.number().int().positive().nullable().optional(),
		scoringStrategy: z.string().nullable().optional(),
		scoreNormalized: z.boolean().nullable().optional(),
		returnScores: z.boolean().nullable().optional(),
		endpointBaseUrl: EndpointBaseUrlSchema.nullable().optional(),
		endpointPath: EndpointPathSchema.nullable().optional(),
		requestTimeoutMs: z.number().int().positive().nullable().optional(),
		maxBatchSize: z.number().int().positive().nullable().optional(),
		authType: AuthTypeSchema.optional(),
		credentialRef: z.string().nullable().optional(),
		supportedLanguages: z.array(z.string()).optional(),
		supportedContent: z.array(z.string()).optional(),
	})
	.openapi("CreateRerankingServiceInput");

export const UpdateRerankingServiceInputSchema =
	CreateRerankingServiceInputSchema.partial()
		.omit({ rerankingServiceId: true })
		.openapi("UpdateRerankingServiceInput");

/* ---------- LLM service ---------- */

export const LlmServiceRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		llmServiceId: z.string().uuid(),
		name: z.string(),
		description: z.string().nullable(),
		status: ServiceStatusSchema,
		provider: z.string(),
		engine: z.string().nullable(),
		modelName: z.string(),
		modelVersion: z.string().nullable(),
		contextWindowTokens: z.number().int().nullable(),
		maxOutputTokens: z.number().int().nullable(),
		temperatureMin: z.number().nullable(),
		temperatureMax: z.number().nullable(),
		supportsStreaming: z.boolean().nullable(),
		supportsTools: z.boolean().nullable(),
		endpointBaseUrl: z.string().nullable(),
		endpointPath: z.string().nullable(),
		requestTimeoutMs: z.number().int().nullable(),
		maxBatchSize: z.number().int().nullable(),
		authType: AuthTypeSchema,
		credentialRef: z.string().nullable(),
		supportedLanguages: z.array(z.string()),
		supportedContent: z.array(z.string()),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("LlmService");

export const LlmServicePageSchema = pageSchema(
	"LlmServicePage",
	LlmServiceRecordSchema,
);

export const CreateLlmServiceInputSchema = z
	.object({
		llmServiceId: z.string().uuid().optional(),
		name: z.string().min(1),
		description: z.string().nullable().optional(),
		status: ServiceStatusSchema.optional(),
		provider: z.string().min(1),
		engine: z.string().nullable().optional(),
		modelName: z.string().min(1),
		modelVersion: z.string().nullable().optional(),
		contextWindowTokens: z.number().int().positive().nullable().optional(),
		maxOutputTokens: z.number().int().positive().nullable().optional(),
		temperatureMin: z.number().nullable().optional(),
		temperatureMax: z.number().nullable().optional(),
		supportsStreaming: z.boolean().nullable().optional(),
		supportsTools: z.boolean().nullable().optional(),
		endpointBaseUrl: EndpointBaseUrlSchema.nullable().optional(),
		endpointPath: EndpointPathSchema.nullable().optional(),
		requestTimeoutMs: z.number().int().positive().nullable().optional(),
		maxBatchSize: z.number().int().positive().nullable().optional(),
		authType: AuthTypeSchema.optional(),
		credentialRef: z.string().nullable().optional(),
		supportedLanguages: z.array(z.string()).optional(),
		supportedContent: z.array(z.string()).optional(),
	})
	.openapi("CreateLlmServiceInput");

export const UpdateLlmServiceInputSchema = CreateLlmServiceInputSchema.partial()
	.omit({ llmServiceId: true })
	.openapi("UpdateLlmServiceInput");

/* ---------- LLM model catalog (model picker) ---------- */

/**
 * One selectable chat model returned by `GET /api/v1/llm-models`.
 * `supportsTools` is `null` when the source can't introspect tool
 * support (e.g. a local Ollama model); the OpenRouter catalog is
 * pre-filtered to tool-calling-capable models so its entries are
 * always `true`.
 */
export const LlmModelInfoSchema = z
	.object({
		id: z.string().openapi({ example: "openai/gpt-4o-mini" }),
		name: z.string().openapi({ example: "OpenAI: GPT-4o mini" }),
		supportsTools: z.boolean().nullable(),
		recommended: z.boolean(),
	})
	.openapi("LlmModelInfo");

/**
 * Response of `GET /api/v1/llm-models`. `source` distinguishes a live
 * provider catalog from the curated static fallback served when the
 * upstream is unreachable (offline installs, OpenRouter outage).
 */
export const LlmModelListSchema = z
	.object({
		provider: z.string().openapi({ example: "openrouter" }),
		source: z.enum(["live", "fallback"]),
		models: z.array(LlmModelInfoSchema),
	})
	.openapi("LlmModelList");

/* ---------- URL params ---------- */

export const KnowledgeBaseIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "knowledgeBaseId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

export const KnowledgeFilterIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "knowledgeFilterId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

export const ChunkingServiceIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "chunkingServiceId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

export const AgentIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "agentId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

export const ConversationIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "conversationId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

/* ---------- Chat messages (agent-conversation-scoped) ---------- */

/**
 * Wire-shape for a chat message. Mirrors `MessageRecord` minus the
 * Stage-2 tool fields that aren't used by the v0 surface (no tools
 * are wired yet). RAG provenance lives in `metadata.context_document_ids`
 * as a comma-separated string for v0; future rev can promote it to
 * a typed array.
 */
export const ChatMessageRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		chatId: z.string().uuid(),
		messageId: z.string().uuid(),
		messageTs: DateTimeSchema,
		role: z.enum(["user", "agent", "system"]),
		content: z.string().nullable(),
		tokenCount: z.number().int().nullable(),
		metadata: z.record(z.string(), z.string()),
	})
	.openapi("ChatMessage");

export const ChatMessagePageSchema = pageSchema(
	"ChatMessagePage",
	ChatMessageRecordSchema,
);

/**
 * Body of `POST .../conversations/{c}/messages`. The runtime always
 * authors the assistant turn from the configured model; the only
 * thing the caller supplies is the user-typed content.
 */
export const SendChatMessageInputSchema = z
	.object({
		content: z.string().min(1).max(MAX_CHAT_MESSAGE_CHARS),
	})
	.openapi("SendChatMessageInput");

/**
 * Response of `POST .../conversations/{c}/messages`. Both turns are
 * returned so the UI can replace any optimistic user-message stub
 * with the canonical persisted version, and append the assistant
 * reply in one render pass. When the model errors, `assistant.metadata`
 * contains `finish_reason: "error"` and the body is the human-
 * readable failure message.
 */
export const SendChatMessageResponseSchema = z
	.object({
		user: ChatMessageRecordSchema,
		assistant: ChatMessageRecordSchema,
	})
	.openapi("SendChatMessageResponse");

/**
 * Documentary schema for the `text/event-stream` body returned by
 * `POST .../conversations/{c}/messages/stream`. The wire format is
 * Server-Sent Events; each line is a `data:` payload whose JSON shape
 * depends on the `event:` name. Captured here as a discriminated union
 * on `event` so the OpenAPI doc names every event kind even though the
 * underlying transport is line-oriented text.
 *
 * Event ordering on a successful turn (no tool calls):
 *   `user-message` → `token`* → `done`
 *
 * Tool-calling turns interleave:
 *   `user-message` → `token`* → `token-reset` → `tool-call` →
 *   `tool-result`+ → `token`* → `done`
 *
 * Failure paths emit one of `error` (model failure, persisted) or
 * `stream-error` (route-level exception with the same envelope shape
 * as the JSON `errorResponse` helper) and then close the stream.
 */
export const MessageStreamUserEventSchema = z
	.object({
		event: z.literal("user-message"),
		data: ChatMessageRecordSchema,
	})
	.openapi("MessageStreamUserEvent");

export const MessageStreamTokenEventSchema = z
	.object({
		event: z.literal("token"),
		data: z.object({ delta: z.string() }),
	})
	.openapi("MessageStreamTokenEvent");

export const MessageStreamTokenResetEventSchema = z
	.object({
		event: z.literal("token-reset"),
		data: z.object({}),
	})
	.openapi("MessageStreamTokenResetEvent");

export const MessageStreamToolCallEventSchema = z
	.object({
		event: z.literal("tool-call"),
		data: z.object({
			toolCalls: z.array(
				z.object({
					id: z.string(),
					name: z.string(),
					arguments: z.string(),
				}),
			),
		}),
	})
	.openapi("MessageStreamToolCallEvent");

export const MessageStreamToolResultEventSchema = z
	.object({
		event: z.literal("tool-result"),
		data: z.object({
			toolCallId: z.string(),
			name: z.string(),
			content: z.string(),
		}),
	})
	.openapi("MessageStreamToolResultEvent");

export const MessageStreamDoneEventSchema = z
	.object({
		event: z.literal("done"),
		data: ChatMessageRecordSchema,
	})
	.openapi("MessageStreamDoneEvent");

export const MessageStreamErrorEventSchema = z
	.object({
		event: z.literal("error"),
		data: ChatMessageRecordSchema,
	})
	.openapi("MessageStreamErrorEvent");

export const MessageStreamStreamErrorEventSchema = z
	.object({
		event: z.literal("stream-error"),
		data: z.object({
			code: z.string(),
			message: z.string(),
			status: z.number().int(),
		}),
	})
	.openapi("MessageStreamStreamErrorEvent");

export const MessageStreamEventSchema = z
	.discriminatedUnion("event", [
		MessageStreamUserEventSchema,
		MessageStreamTokenEventSchema,
		MessageStreamTokenResetEventSchema,
		MessageStreamToolCallEventSchema,
		MessageStreamToolResultEventSchema,
		MessageStreamDoneEventSchema,
		MessageStreamErrorEventSchema,
		MessageStreamStreamErrorEventSchema,
	])
	.openapi("MessageStreamEvent");

/* ---------- Agents (workspace-scoped) ---------- */

/**
 * Wire-shape for an agent. Mirrors the
 * `wb_agentic_agents_by_workspace` row, minus the `tool_ids` set
 * (no tools are wired in v0; the column stays as future-proofing).
 */
export const AgentRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		agentId: z.string().uuid(),
		name: z.string(),
		description: z.string().nullable(),
		systemPrompt: z.string().nullable(),
		userPrompt: z.string().nullable(),
		llmServiceId: z.string().uuid().nullable(),
		knowledgeBaseIds: z.array(z.string().uuid()),
		toolIds: z.array(z.string()),
		rerankEnabled: z.boolean(),
		rerankingServiceId: z.string().uuid().nullable(),
		rerankMaxResults: z.number().int().nullable(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("Agent");

export const AgentPageSchema = pageSchema("AgentPage", AgentRecordSchema);

export const CreateAgentInputSchema = z
	.object({
		agentId: z.string().uuid().optional(),
		name: z.string().min(1).max(MAX_AGENT_NAME_CHARS),
		description: z
			.string()
			.max(MAX_AGENT_DESCRIPTION_CHARS)
			.nullable()
			.optional(),
		systemPrompt: z.string().max(MAX_AGENT_PROMPT_CHARS).nullable().optional(),
		userPrompt: z.string().max(MAX_AGENT_PROMPT_CHARS).nullable().optional(),
		llmServiceId: z.string().uuid().nullable().optional(),
		knowledgeBaseIds: z.array(z.string().uuid()).optional(),
		rerankEnabled: z.boolean().optional(),
		rerankingServiceId: z.string().uuid().nullable().optional(),
		rerankMaxResults: z.number().int().positive().nullable().optional(),
		// Per-agent tool allow-list (tool ids/names). Omitted or empty →
		// all built-in workspace tools (grandfathered). External-MCP and
		// native tool ids are opt-in: only what's listed is offered.
		toolIds: z.array(z.string().min(1)).optional(),
	})
	.openapi("CreateAgentInput");

export const UpdateAgentInputSchema = z
	.object({
		name: z.string().min(1).max(MAX_AGENT_NAME_CHARS).optional(),
		description: z
			.string()
			.max(MAX_AGENT_DESCRIPTION_CHARS)
			.nullable()
			.optional(),
		systemPrompt: z.string().max(MAX_AGENT_PROMPT_CHARS).nullable().optional(),
		userPrompt: z.string().max(MAX_AGENT_PROMPT_CHARS).nullable().optional(),
		llmServiceId: z.string().uuid().nullable().optional(),
		knowledgeBaseIds: z.array(z.string().uuid()).optional(),
		rerankEnabled: z.boolean().optional(),
		rerankingServiceId: z.string().uuid().nullable().optional(),
		rerankMaxResults: z.number().int().positive().nullable().optional(),
		// Per-agent tool allow-list (tool ids/names). Empty array →
		// all built-in workspace tools (grandfathered); a non-empty set
		// selects exactly those across built-in + native + Astra +
		// remote-MCP. A1 deferred PATCH-toolIds to A6: settable at create
		// only until now. Mirrors `CreateAgentInput.toolIds`.
		toolIds: z.array(z.string().min(1)).optional(),
	})
	.strict()
	.openapi("UpdateAgentInput");

/* ---------- Agent templates (catalog) ---------- */

/**
 * Read-only catalog entry exposed by `GET /agent-templates`. Templates
 * are static runtime data — they are not records, do not have UUIDs,
 * and are identified by stable lowercase-kebab `templateId` slugs.
 * See ADR 0003 for the design context.
 */
export const AgentTemplateSchema = z
	.object({
		templateId: z.string().min(1),
		name: z.string().min(1),
		description: z.string(),
		persona: z.string(),
		systemPrompt: z.string(),
		defaultOnNewWorkspace: z.boolean(),
	})
	.openapi("AgentTemplate");

export const AgentTemplateListSchema = z
	.object({
		items: z.array(AgentTemplateSchema),
	})
	.openapi("AgentTemplateList");

/**
 * Body of `POST .../agents/from-template`. Single field — the slug
 * of the template to instantiate. Other agent fields default to the
 * template's baked-in values; callers that need overrides should
 * call `POST .../agents` with a hand-built body instead.
 */
export const CreateAgentFromTemplateInputSchema = z
	.object({
		templateId: z.string().min(1),
	})
	.strict()
	.openapi("CreateAgentFromTemplateInput");

/* ---------- Available tools (catalog) ---------- */

/**
 * One selectable entry in the agent tool catalog exposed by
 * `GET .../available-tools`. The `id` is the namespaced tool id an agent
 * lists in its `toolIds` allow-list (`search_kb`, `native:fetch`,
 * `astra:data_api`, `mcp:{serverId}:{tool}`); `source` drives the
 * grouping in the agent-form picker. The catalog reflects what is
 * actually wired for the workspace (native only when configured, astra
 * only for astra/hcd, mcp tools per registered server), so it is
 * workspace-scoped runtime data — not a stored record.
 */
export const AvailableToolSchema = z
	.object({
		id: z.string(),
		description: z.string(),
		source: z.enum(["builtin", "native", "astra", "mcp"]),
		// 0.5.0 (MCP P4): grouping + schema hints for the agent-form picker.
		// All optional + additive. Populated for `source: "mcp"`:
		//   - serverId / serverLabel let the UI sub-group tools by server.
		//   - inputSchema is the tool's JSON-Schema arguments object so the
		//     form can surface required args.
		serverId: z.string().optional(),
		serverLabel: z.string().optional(),
		inputSchema: z.record(z.string(), z.unknown()).optional(),
	})
	.openapi("AvailableTool");

export const AvailableToolListSchema = z
	.object({
		items: z.array(AvailableToolSchema),
	})
	.openapi("AvailableToolList");

/* ---------- Conversations (agent-scoped) ---------- */

/**
 * Wire-shape for an agent-scoped conversation. Backed by the
 * `wb_agentic_conversations_by_agent` table.
 */
export const ConversationRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		agentId: z.string().uuid(),
		conversationId: z.string().uuid(),
		title: z.string().nullable(),
		knowledgeBaseIds: z.array(z.string().uuid()),
		createdAt: DateTimeSchema,
	})
	.openapi("Conversation");

export const ConversationPageSchema = pageSchema(
	"ConversationPage",
	ConversationRecordSchema,
);

export const CreateConversationInputSchema = z
	.object({
		conversationId: z.string().uuid().optional(),
		title: z.string().min(1).nullable().optional(),
		knowledgeBaseIds: z.array(z.string().uuid()).optional(),
	})
	.openapi("CreateConversationInput");

export const UpdateConversationInputSchema = z
	.object({
		title: z.string().min(1).nullable().optional(),
		knowledgeBaseIds: z.array(z.string().uuid()).optional(),
	})
	.strict()
	.openapi("UpdateConversationInput");

export const EmbeddingServiceIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "embeddingServiceId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

export const RerankingServiceIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "rerankingServiceId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

export const LlmServiceIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "llmServiceId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

/* ---------- RAG document (KB-scoped) ---------- */

export const RagDocumentRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		knowledgeBaseId: z.string().uuid(),
		documentId: z.string().uuid(),
		sourceDocId: z.string().nullable(),
		sourceFilename: z.string().nullable(),
		fileType: z.string().nullable(),
		fileSize: z.number().int().nonnegative().nullable(),
		contentHash: z.string().nullable(),
		chunkTotal: z.number().int().nonnegative().nullable(),
		ingestedAt: DateTimeSchema.nullable(),
		updatedAt: DateTimeSchema,
		status: DocumentStatusSchema,
		errorMessage: z.string().nullable(),
		metadata: z.record(z.string(), z.string()),
		/** RLAC: principal ids (and/or `"*"` for any principal) that
		 * may read this row. Null for legacy / pre-RLAC documents. */
		visibleTo: z.array(z.string()).nullable(),
		/** RLAC: provenance — never used for enforcement. */
		ownerPrincipalId: z.string().nullable(),
	})
	.openapi("RagDocument");

export const RagDocumentPageSchema = pageSchema(
	"RagDocumentPage",
	RagDocumentRecordSchema,
);

export const CreateRagDocumentInputSchema = z
	.object({
		documentId: z.string().uuid().optional(),
		sourceDocId: z.string().nullable().optional(),
		sourceFilename: z.string().nullable().optional(),
		fileType: z.string().nullable().optional(),
		fileSize: z.number().int().nonnegative().nullable().optional(),
		contentHash: z.string().nullable().optional(),
		chunkTotal: z.number().int().nonnegative().nullable().optional(),
		ingestedAt: DateTimeSchema.nullable().optional(),
		status: DocumentStatusSchema.optional(),
		errorMessage: z.string().nullable().optional(),
		metadata: z.record(z.string(), z.string()).optional(),
		/** RLAC: principal ids (and/or `"*"`) authorized to read this
		 * document. Omitted = inherit workspace default. */
		visibleTo: z.array(z.string()).nullable().optional(),
		/** RLAC: provenance only. Omitted = creator principal. */
		ownerPrincipalId: z.string().nullable().optional(),
	})
	.openapi("CreateRagDocumentInput");

export const UpdateRagDocumentInputSchema =
	CreateRagDocumentInputSchema.partial()
		.omit({ documentId: true })
		.openapi("UpdateRagDocumentInput");

/**
 * KB-scoped ingest request. `metadata` reserves `knowledgeBaseId` /
 * `documentId` (the runtime overrides any caller-supplied values
 * with the path-resolved KB and the freshly created document row).
 */
export const KbIngestRequestSchema = z
	.object({
		text: z.string().min(1).max(MAX_INGEST_TEXT_CHARS),
		documentId: z.string().uuid().optional(),
		sourceDocId: z.string().nullable().optional(),
		sourceFilename: z.string().nullable().optional(),
		fileType: z.string().nullable().optional(),
		fileSize: z.number().int().nonnegative().nullable().optional(),
		contentHash: z.string().nullable().optional(),
		metadata: z.record(z.string(), z.string()).optional(),
		chunker: IngestChunkerOptionsSchema.optional(),
		/**
		 * When true, an existing document in this KB with the same
		 * `sourceFilename` but a different content hash is
		 * cascade-deleted (chunks + row) before this ingest runs.
		 * When false / omitted (the default), a name collision with
		 * different content surfaces as a 200 `name_conflict`
		 * response so the client can prompt the user. The flag has
		 * no effect when no name collision exists or when the
		 * existing doc's content hash matches (that's the regular
		 * dedup path → 200 `duplicate`).
		 */
		overwriteOnNameConflict: z.boolean().optional(),
		/** RLAC: principal ids (and/or `"*"`) authorized to read this
		 * document. Omitted = the route defaults to the caller's
		 * principal when policy is enabled on the KB. */
		visibleTo: z.array(z.string()).nullable().optional(),
		/** RLAC: provenance only. Omitted = caller's principal id. */
		ownerPrincipalId: z.string().nullable().optional(),
	})
	.openapi("KbIngestRequest");

export const KbIngestResponseSchema = z
	.object({
		document: RagDocumentRecordSchema,
		chunks: z.number().int().nonnegative(),
		/** Astra Data API calls the runtime made on the user's behalf
		 * — one representative `insert_chunks` snapshot for Astra/HCD
		 * workspaces, empty otherwise. The actual pipeline runs the
		 * captured call once per chunk batch; the chip footer notes
		 * the repetition. */
		astraQueries: z.array(AstraQuerySnapshotSchema),
	})
	.openapi("KbIngestResponse");

export const KbAsyncIngestResponseSchema = z
	.object({
		job: JobRecordSchema,
		document: RagDocumentRecordSchema,
		/** Same shape as the sync `astraQueries`. Surfaced eagerly at
		 * queue-time so the user can view + copy the call before the
		 * background pipeline finishes. */
		astraQueries: z.array(AstraQuerySnapshotSchema),
	})
	.openapi("KbAsyncIngestResponse");

/**
 * Returned when an ingest request's content (SHA-256 of the body
 * `text`) matches an existing document in the same KB. The pipeline
 * does NOT run again; the existing document is returned verbatim.
 * Distinguished from 201 by the `outcome: "duplicate"` field and
 * the absence of `chunks` / `job`.
 */
export const KbIngestDuplicateResponseSchema = z
	.object({
		document: RagDocumentRecordSchema,
		outcome: z.literal("duplicate"),
	})
	.openapi("KbIngestDuplicateResponse");

/**
 * Returned when an ingest request's `sourceFilename` matches an
 * existing document in this KB but the content hash differs and the
 * caller didn't set `overwriteOnNameConflict: true`. The existing
 * document is returned so the UI can show the user what's about to
 * be replaced; the new content is NOT ingested. The expected client
 * follow-up is to prompt the user and either re-issue the request
 * with `overwriteOnNameConflict: true` (overwrite path) or skip the
 * file (no further request).
 */
export const KbIngestNameConflictResponseSchema = z
	.object({
		document: RagDocumentRecordSchema,
		outcome: z.literal("name_conflict"),
	})
	.openapi("KbIngestNameConflictResponse");

/**
 * Discriminated union of the two 200 outcomes. The route registers
 * this as the 200 response so both `duplicate` and `name_conflict`
 * surface in the OpenAPI document and the generated wire types are
 * a true union (rather than the older single-arm `duplicate` shape
 * we shipped in phase 1).
 */
export const KbIngestNonCreateResponseSchema = z
	.discriminatedUnion("outcome", [
		KbIngestDuplicateResponseSchema,
		KbIngestNameConflictResponseSchema,
	])
	.openapi("KbIngestNonCreateResponse");

/* ---------------- Connect (pluggability) ---------------- */

/**
 * Stable identifiers for each framework target the Connect tab
 * renders. Add new ids at the end of the array; renaming is a
 * wire-break (customers screenshot the rendered tabs).
 */
export const ConnectTargetIdSchema = z
	.enum([
		"langgraph",
		"crewai",
		"google-adk",
		"microsoft-agent-framework",
		"watsonx",
		"mcp-raw",
	])
	.openapi("ConnectTargetId");

export const ConnectSnippetLanguageSchema = z
	.enum(["python", "typescript", "bash", "text"])
	.openapi("ConnectSnippetLanguage");

export const ConnectSnippetTransportSchema = z
	.enum(["mcp", "rest", "manual"])
	.openapi("ConnectSnippetTransport");

/**
 * One rendered framework recipe. Pure projection of the workspace +
 * KB scope into a copy-pasteable code block plus framework metadata.
 * Secrets never appear in `code` — the snippet reads the API key from
 * the env var the UI tells the user to set.
 */
export const ConnectSnippetSchema = z
	.object({
		id: ConnectTargetIdSchema,
		displayName: z.string().min(1),
		tagline: z.string().min(1),
		language: ConnectSnippetLanguageSchema,
		transport: ConnectSnippetTransportSchema,
		install: z.string().min(1).nullable(),
		code: z.string().min(1),
		requiresMcp: z.boolean(),
		docsUrl: z.string().url(),
		notes: z.string().min(1).nullable(),
	})
	.openapi("ConnectSnippet");

/**
 * Aggregate response for `GET /api/v1/workspaces/{w}/connect/snippets`.
 * Includes the resolved endpoint URLs alongside the per-target
 * snippets so the UI's "Endpoints" card can render without a second
 * request.
 */
export const ConnectSnippetsResponseSchema = z
	.object({
		workspaceId: z.string().uuid(),
		knowledgeBaseId: z.string().uuid().nullable(),
		publicBaseUrl: z.string().url(),
		mcpUrl: z.string().url(),
		restBaseUrl: z.string().url(),
		mcpEnabled: z.boolean(),
		apiKeyEnvVar: z.string().min(1),
		targets: z.array(ConnectSnippetSchema),
	})
	.openapi("ConnectSnippetsResponse");

/**
 * Query parameters accepted by the snippets route. All optional —
 * the route renders every target for the whole workspace when nothing
 * is supplied. `knowledgeBaseId` narrows the snippets so the rendered
 * code defaults retrieval to one KB; the route does NOT validate KB
 * existence here so the snippet stays useful even for a KB that's
 * being staged elsewhere.
 */
export const ConnectSnippetsQuerySchema = z
	.object({
		knowledgeBaseId: z.string().uuid().optional(),
		apiKeyEnvVar: z
			.string()
			.min(1)
			.regex(
				/^[A-Z_][A-Z0-9_]*$/,
				"apiKeyEnvVar must be a valid POSIX env-var name (upper-case, digits, underscore)",
			)
			.optional(),
	})
	.openapi("ConnectSnippetsQuery");

/**
 * Wire shape for the "Verify endpoint" smoke test: `POST
 * /api/v1/workspaces/{w}/connect/verify` runs an internal JSON-RPC
 * `tools/list` against the workspace's MCP server and reports what it
 * finds back to the UI. Always 200 — failures are signalled inside the
 * envelope (`ok: false` + structured `error`) so the UI can render a
 * red-state badge without having to differentiate a 500 from a
 * legitimate "MCP off" answer.
 */
export const ConnectVerifyResponseSchema = z
	.object({
		ok: z.boolean(),
		mcpEnabled: z.boolean(),
		toolCount: z.number().int().nonnegative(),
		tools: z.array(z.string()),
		latencyMs: z.number().int().nonnegative(),
		error: z
			.object({
				code: z.string(),
				message: z.string(),
			})
			.nullable(),
	})
	.openapi("ConnectVerifyResponse");

/**
 * One row of the workspace's recent-MCP-invocation feed. Projection
 * of the audit envelope the in-memory buffer captures; payload bodies
 * are deliberately omitted (could contain user prompts / KB ids).
 */
export const ConnectTrafficEntrySchema = z
	.object({
		at: z.string(),
		toolName: z.string(),
		outcome: z.enum(["success", "failure", "denied"]),
		subjectType: z.enum(["apiKey", "oidc", "bootstrap", "anonymous", "system"]),
		subjectLabel: z.string().nullable(),
		reason: z.string().nullable(),
	})
	.openapi("ConnectTrafficEntry");

/**
 * Aggregate response for the Connect tab's "Recent integration
 * traffic" strip. Carries both a flat list (newest first) and a
 * pre-computed summary so the UI doesn't have to fold over the
 * entries to render the header counts.
 *
 * Buffer is in-memory only — restarts wipe it. The authoritative
 * audit trail is in the pino logger.
 */
export const ConnectTrafficResponseSchema = z
	.object({
		workspaceId: z.string().uuid(),
		mcpEnabled: z.boolean(),
		entries: z.array(ConnectTrafficEntrySchema),
		summary: z.object({
			total: z.number().int().nonnegative(),
			successes: z.number().int().nonnegative(),
			failures: z.number().int().nonnegative(),
		}),
	})
	.openapi("ConnectTrafficResponse");

/**
 * Optional query knobs on the traffic route. `limit` is hard-capped
 * server-side so a misbehaving UI can't request a million entries.
 */
export const ConnectTrafficQuerySchema = z
	.object({
		limit: z.coerce.number().int().min(1).max(200).optional(),
	})
	.openapi("ConnectTrafficQuery");

/* ====================================================================== */
/*                                                                        */
/* RLAC prototype schemas — principals, policy DSL, policy audit.         */
/*                                                                        */
/* See `docs/rlac-prototype/data-api-design-ask.md` for the model and the */
/* design ask to the Data API team.                                       */
/*                                                                        */
/* ====================================================================== */

export const PrincipalIdParamSchema = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[A-Za-z0-9._@:+-]+$/, "principal_id must be URL-safe")
	.openapi({
		param: { name: "principalId", in: "path" },
		example: "alice",
	});

/** RBAC role (mirrors `Role` in `control-plane/types.ts`). */
export const RoleSchema = z.enum(["viewer", "editor", "admin"]).openapi("Role");

export const PrincipalRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		principalId: z.string(),
		label: z.string().nullable(),
		attributes: z.record(z.string(), z.string()),
		role: RoleSchema,
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("Principal");

export const PrincipalPageSchema = pageSchema(
	"PrincipalPage",
	PrincipalRecordSchema,
);

export const CreatePrincipalInputSchema = z
	.object({
		principalId: z
			.string()
			.min(1)
			.max(128)
			.regex(/^[A-Za-z0-9._@:+-]+$/, "principal_id must be URL-safe"),
		label: z.string().max(200).nullable().optional(),
		attributes: z.record(z.string(), z.string()).optional(),
		role: RoleSchema.optional().openapi({
			description: "RBAC role to assign. Defaults to `viewer` when omitted.",
		}),
	})
	.strict()
	.openapi("CreatePrincipalInput");

export const UpdatePrincipalInputSchema = z
	.object({
		label: z.string().max(200).nullable().optional(),
		attributes: z.record(z.string(), z.string()).optional(),
		role: RoleSchema.optional(),
	})
	.strict()
	.openapi("UpdatePrincipalInput");

export const PolicyCompilePreviewRequestSchema = z
	.object({
		dsl: z.string().min(1).max(4000),
		principalId: z.string().min(1).max(128).optional(),
	})
	.strict()
	.openapi("PolicyCompilePreviewRequest");

export const PolicyValidationIssueSchema = z
	.object({
		code: z.string(),
		message: z.string(),
		hint: z.string().optional(),
	})
	.openapi("PolicyValidationIssue");

export const PolicyCompilePreviewResponseSchema = z
	.object({
		ok: z.boolean(),
		parseError: z.string().nullable(),
		issues: z.array(PolicyValidationIssueSchema),
		compiledFilter: z.unknown().nullable(),
		principalId: z.string().nullable(),
	})
	.openapi("PolicyCompilePreviewResponse");

export const PolicyAuditRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		auditDay: z.string(),
		ts: DateTimeSchema,
		decisionId: z.string().uuid(),
		principalId: z.string().nullable(),
		knowledgeBaseId: z.string().uuid(),
		resourceId: z.string(),
		action: z.enum(["list", "get", "search", "ingest", "update", "delete"]),
		decision: z.enum(["allow", "deny", "filter"]),
		reason: z.string(),
		compiledFilterJson: z.string().nullable(),
	})
	.openapi("PolicyAuditRecord");

export const PolicyAuditPageSchema = pageSchema(
	"PolicyAuditPage",
	PolicyAuditRecordSchema,
);

export const PolicyAuditQuerySchema = z
	.object({
		principalId: z.string().optional(),
		knowledgeBaseId: z.string().uuid().optional(),
		auditDay: z
			.string()
			.regex(/^\d{4}-\d{2}-\d{2}$/, "audit_day must be YYYY-MM-DD")
			.optional(),
		limit: z.coerce.number().int().min(1).max(500).optional(),
	})
	.openapi("PolicyAuditQuery");

/* ====================================================================== */
/* External MCP servers (0.4.0 A2)                                        */
/*                                                                        */
/* Per-workspace registry of remote MCP servers the agents can reach. The */
/* runtime discovers each server's tools at turn time and adapts them into */
/* agent tools named `mcp:{mcpServerId}:{toolName}`.                       */
/* ====================================================================== */

export const McpServerIdParamSchema = z
	.string()
	.uuid()
	.openapi({
		param: { name: "mcpServerId", in: "path" },
		example: "11111111-2222-3333-4444-555555555555",
	});

/**
 * MCP-server URL. Reuses the service-endpoint SSRF guard
 * ({@link EndpointBaseUrlSchema}): http(s) only, cloud-metadata and
 * link-local hosts blocked, private networks blocked in production. The
 * runtime re-validates at dial time and routes the request through
 * `safeFetch`, so this is defense-in-depth at config-write time.
 */
const McpServerUrlSchema = EndpointBaseUrlSchema.openapi("McpServerUrl", {
	example: "https://mcp.example.com/mcp",
});

export const McpServerRecordSchema = z
	.object({
		workspaceId: z.string().uuid(),
		mcpServerId: z.string().uuid(),
		label: z.string(),
		url: z.string(),
		credentialRef: SecretRefSchema.nullable(),
		enabled: z.boolean(),
		allowedTools: z.array(z.string()).nullable(),
		createdAt: DateTimeSchema,
		updatedAt: DateTimeSchema,
	})
	.openapi("McpServer");

export const McpServerPageSchema = pageSchema(
	"McpServerPage",
	McpServerRecordSchema,
);

export const CreateMcpServerInputSchema = z
	.object({
		label: z.string().min(1).max(200),
		url: McpServerUrlSchema,
		credentialRef: SecretRefSchema.nullable().optional(),
		enabled: z.boolean().optional().openapi({
			description: "Whether the server's tools are exposed. Defaults to true.",
		}),
		allowedTools: z.array(z.string().min(1)).nullable().optional().openapi({
			description:
				"Allow-list of remote tool names to expose. Omit / null = expose every tool the server advertises; empty array = expose none.",
		}),
	})
	.strict()
	.openapi("CreateMcpServerInput");

export const UpdateMcpServerInputSchema = z
	.object({
		label: z.string().min(1).max(200).optional(),
		url: McpServerUrlSchema.optional(),
		credentialRef: SecretRefSchema.nullable().optional(),
		enabled: z.boolean().optional(),
		allowedTools: z.array(z.string().min(1)).nullable().optional(),
	})
	.strict()
	.openapi("UpdateMcpServerInput");
