import { beforeEach, describe, expect, it } from "vitest";
import type { RemoteMcpTool } from "../../../src/chat/tools/mcp-client.js";
import {
	clearMcpDiscoveryCache,
	discoveryCacheKey,
	getCachedDiscovery,
	invalidateMcpServer,
	setCachedDiscovery,
} from "../../../src/chat/tools/mcp-discovery-cache.js";

const tool = (name: string): RemoteMcpTool => ({
	name,
	description: name,
	inputSchema: { type: "object" },
});

describe("mcp-discovery-cache", () => {
	beforeEach(() => clearMcpDiscoveryCache());

	it("misses, returns within TTL, and evicts at/after the deadline", () => {
		const key = discoveryCacheKey("ws", "srv", "https://x/mcp", null);
		expect(getCachedDiscovery(key, 1_000)).toBeNull();

		// expiresAt = 5000 (absolute epoch-ms, the caller's now + ttl).
		setCachedDiscovery(key, [tool("echo")], 5_000);
		expect(getCachedDiscovery(key, 4_999)?.map((t) => t.name)).toEqual([
			"echo",
		]);

		// `now >= expiresAt` is a miss (and evicts).
		expect(getCachedDiscovery(key, 5_000)).toBeNull();
		expect(getCachedDiscovery(key, 6_000)).toBeNull();
	});

	it("keys distinctly by (workspace, server, url, credentialRef)", () => {
		const a = discoveryCacheKey("ws", "srv", "https://x/mcp", "env:A");
		expect(discoveryCacheKey("ws", "srv", "https://x/mcp", "env:B")).not.toBe(
			a,
		);
		expect(discoveryCacheKey("ws", "srv", "https://y/mcp", "env:A")).not.toBe(
			a,
		);
		expect(discoveryCacheKey("ws2", "srv", "https://x/mcp", "env:A")).not.toBe(
			a,
		);
		// null vs "" credentialRef collapse to the same key (both "no ref").
		expect(discoveryCacheKey("ws", "srv", "https://x/mcp", null)).toBe(
			discoveryCacheKey("ws", "srv", "https://x/mcp", ""),
		);
	});

	it("invalidateMcpServer drops every url/credentialRef variant of one server", () => {
		const k1 = discoveryCacheKey("ws", "srv", "https://x/mcp", "env:A");
		const k2 = discoveryCacheKey("ws", "srv", "https://y/mcp", "env:B");
		const other = discoveryCacheKey("ws", "other", "https://z/mcp", null);
		setCachedDiscovery(k1, [tool("a")], 10_000);
		setCachedDiscovery(k2, [tool("b")], 10_000);
		setCachedDiscovery(other, [tool("c")], 10_000);

		invalidateMcpServer("ws", "srv");

		expect(getCachedDiscovery(k1, 0)).toBeNull();
		expect(getCachedDiscovery(k2, 0)).toBeNull();
		// A different server in the same workspace is untouched.
		expect(getCachedDiscovery(other, 0)?.map((t) => t.name)).toEqual(["c"]);
	});
});
