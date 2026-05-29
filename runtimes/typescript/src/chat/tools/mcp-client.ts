/**
 * Minimal client for a remote MCP server over Streamable HTTP (0.4.0 A2).
 *
 * Wraps the `@modelcontextprotocol/sdk` `Client` so the rest of the
 * runtime sees a tiny surface — `listTools()` / `callTool()` / `close()` —
 * and never touches transport wiring. The remote-MCP tool provider
 * (`providers/remote-mcp.ts`) opens one of these per enabled server,
 * lists its tools, and adapts each into an agent tool.
 *
 * ## Security
 *
 * The server URL is validated through the **same SSRF guard** that gates
 * service endpoints ({@link EndpointBaseUrlSchema}): cloud-metadata and
 * link-local hosts are rejected, and private networks too when the egress
 * policy is locked down (production). All outbound HTTP additionally flows
 * through {@link safeFetch}, which disables redirect-following so a public
 * host can't 30x us onto `169.254.169.254`. The credential is resolved
 * from a {@link SecretRef} via the {@link SecretResolver} and sent as a
 * bearer token — the raw value never leaves this module.
 *
 * ## Testability
 *
 * `connectMcpClient` accepts an optional `transportFactory`. Production
 * uses the default (a `StreamableHTTPClientTransport` pointed at the
 * validated URL); tests inject one returning an `InMemoryTransport` linked
 * to a fake server, so the full list-then-call path runs without HTTP.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { safeFetch } from "../../lib/safe-fetch.js";
import { EndpointBaseUrlSchema } from "../../openapi/schemas.js";
import type { SecretResolver } from "../../secrets/provider.js";
import { VERSION } from "../../version.js";

/** A tool as advertised by a remote MCP server's `tools/list`. */
export interface RemoteMcpTool {
	readonly name: string;
	readonly description: string | undefined;
	/** JSON Schema for the tool's arguments (object schema). */
	readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ConnectMcpClientOptions {
	/** Remote server base URL — validated through the SSRF guard. */
	readonly url: string;
	/** Optional `<provider>:<path>` ref for a bearer credential. */
	readonly credentialRef?: string | null;
	readonly secrets: SecretResolver;
	/**
	 * Override the transport (tests inject an in-memory pair). Receives
	 * the validated URL so a custom factory can still honor it; the
	 * default builds a Streamable HTTP transport over `safeFetch`.
	 */
	readonly transportFactory?: (url: URL) => Transport | Promise<Transport>;
	/** Logged client name surfaced to the server. */
	readonly clientName?: string;
}

/**
 * A connected session against one remote MCP server. Thin pass-through to
 * the SDK `Client`, narrowed to the two RPCs the tool layer needs plus
 * lifecycle. Always `close()` it (the provider does so in a `finally`).
 */
export interface RemoteMcpSession {
	listTools(): Promise<readonly RemoteMcpTool[]>;
	/** Invoke a remote tool; returns its flattened text content. */
	callTool(
		name: string,
		args: Readonly<Record<string, unknown>>,
	): Promise<string>;
	close(): Promise<void>;
}

/** Thrown when the configured server URL fails the SSRF / shape guard. */
export class UnsafeMcpServerUrlError extends Error {
	constructor(public readonly url: string) {
		super(
			`MCP server URL '${url}' is not an allowed endpoint (must be http(s); ` +
				"cloud-metadata, link-local, and — in production — private hosts are blocked)",
		);
		this.name = "UnsafeMcpServerUrlError";
	}
}

/**
 * Validate + connect to a remote MCP server. Resolves the credential
 * (if any) before dialing so an auth-config error surfaces as a thrown
 * error the provider can downgrade to a warning, not a half-open client.
 */
export async function connectMcpClient(
	opts: ConnectMcpClientOptions,
): Promise<RemoteMcpSession> {
	// SSRF guard — identical policy to service endpoints. Reuse the schema
	// so the blocked-host list and the private-network egress toggle stay
	// in one place.
	if (!EndpointBaseUrlSchema.safeParse(opts.url).success) {
		throw new UnsafeMcpServerUrlError(opts.url);
	}
	const url = new URL(opts.url);

	const headers: Record<string, string> = {};
	if (opts.credentialRef) {
		const token = await opts.secrets.resolve(opts.credentialRef);
		headers.Authorization = `Bearer ${token}`;
	}

	const transport = opts.transportFactory
		? await opts.transportFactory(url)
		: new StreamableHTTPClientTransport(url, {
				fetch: safeFetch,
				requestInit: { headers },
			});

	const client = new Client({
		name: opts.clientName ?? "ai-workbench",
		version: VERSION,
	});
	await client.connect(transport);

	return {
		async listTools(): Promise<readonly RemoteMcpTool[]> {
			const result = await client.listTools();
			return result.tools.map((t) => ({
				name: t.name,
				description: t.description,
				inputSchema: t.inputSchema as Readonly<Record<string, unknown>>,
			}));
		},

		async callTool(
			name: string,
			args: Readonly<Record<string, unknown>>,
		): Promise<string> {
			const result = await client.callTool({ name, arguments: { ...args } });
			return flattenTextContent(result.content);
		},

		async close(): Promise<void> {
			await client.close();
		},
	};
}

/**
 * Flatten an MCP tool result's `content` array into a single string for
 * the `tool`-role chat turn. Concatenates every `text` item; non-text
 * parts (images, resources) are summarized as a placeholder so the model
 * knows something came back it can't read inline.
 */
export function flattenTextContent(content: unknown): string {
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const item of content) {
		if (item && typeof item === "object") {
			const rec = item as Record<string, unknown>;
			if (rec.type === "text" && typeof rec.text === "string") {
				parts.push(rec.text);
			} else if (typeof rec.type === "string") {
				parts.push(`[${rec.type} content omitted]`);
			}
		}
	}
	return parts.join("\n");
}
