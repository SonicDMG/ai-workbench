/**
 * Pure-logic tests for the `aiw status` command. The citty wrapper +
 * `process.exit` are not exercised — only the building blocks the
 * dispatcher composes.
 */

import { describe, expect, it, vi } from "vitest";
import {
	buildStatusReport,
	FeaturesSchema,
	probe,
	ReadySchema,
	renderHuman,
	type StatusReport,
	VersionSchema,
} from "../src/commands/status.js";

describe("buildStatusReport", () => {
	it("marks unreachable when version probe failed", () => {
		const r = buildStatusReport({
			profile: "default",
			url: "http://localhost:8080",
			version: null,
			ready: null,
			features: null,
		});
		expect(r.reachable).toBe(false);
		expect(r.version).toBeNull();
		expect(r.ready).toBe(false);
		expect(r.workspaces).toBeNull();
		expect(r.ingest).toBeNull();
		expect(r.mcpEnabled).toBeNull();
	});

	it("populates every field when all probes succeed", () => {
		const r = buildStatusReport({
			profile: "prod",
			url: "https://prod.example.com",
			version: { version: "0.2.1", commit: "abc123" },
			ready: {
				status: "ready",
				workspaces: 3,
				ingest: { active: 1, queued: 2, capacity: 4 },
			},
			features: { mcp: { enabled: true, baseUrl: "https://mcp.example.com" } },
		});
		expect(r).toEqual<StatusReport>({
			profile: "prod",
			url: "https://prod.example.com",
			reachable: true,
			version: "0.2.1",
			ready: true,
			workspaces: 3,
			ingest: { active: 1, queued: 2, capacity: 4 },
			mcpEnabled: true,
			mcpUrl: "https://mcp.example.com",
		});
	});

	it("treats ingest without a numeric capacity as 'no data'", () => {
		const r = buildStatusReport({
			profile: "p",
			url: "u",
			version: { version: "0.2.1" },
			ready: { status: "ready", ingest: { active: 0, queued: 0 } as never },
			features: null,
		});
		expect(r.ingest).toBeNull();
	});

	it("defaults ingest.active / ingest.queued to 0 when only capacity is set", () => {
		const r = buildStatusReport({
			profile: "p",
			url: "u",
			version: { version: "0.2.1" },
			ready: { status: "ready", ingest: { capacity: 5 } },
			features: null,
		});
		expect(r.ingest).toEqual({ active: 0, queued: 0, capacity: 5 });
	});

	it("flags `not ready` when status is anything other than 'ready'", () => {
		const r = buildStatusReport({
			profile: "p",
			url: "u",
			version: { version: "0.2.1" },
			ready: { status: "starting" },
			features: null,
		});
		expect(r.ready).toBe(false);
	});
});

describe("renderHuman", () => {
	it("emits a single red ✗ line when unreachable", () => {
		const out = renderHuman({
			profile: "p",
			url: "http://nope",
			reachable: false,
			version: null,
			ready: false,
			workspaces: null,
			ingest: null,
			mcpEnabled: null,
			mcpUrl: null,
		});
		expect(out).toContain("✗");
		expect(out).toContain("http://nope");
		expect(out.split("\n")).toHaveLength(1);
	});

	it("emits a multi-line summary when reachable", () => {
		const out = renderHuman({
			profile: "p",
			url: "http://ok",
			reachable: true,
			version: "0.2.1",
			ready: true,
			workspaces: 4,
			ingest: { active: 2, queued: 1, capacity: 5 },
			mcpEnabled: true,
			mcpUrl: "https://mcp",
		});
		expect(out).toContain("✓");
		expect(out).toContain("version:    0.2.1");
		expect(out).toContain("workspaces: 4");
		expect(out).toContain("2/5 active, 1 queued");
		expect(out).toContain("mcp:        https://mcp");
	});

	it("uses '?' placeholders for missing fields and 'no' for not-ready", () => {
		const out = renderHuman({
			profile: "p",
			url: "u",
			reachable: true,
			version: null,
			ready: false,
			workspaces: null,
			ingest: null,
			mcpEnabled: null,
			mcpUrl: null,
		});
		expect(out).toContain("version:    ?");
		expect(out).toContain("ready:      no");
		expect(out).toContain("workspaces: ?");
		expect(out).toContain("ingest:     n/a");
		expect(out).toContain("mcp:        ?");
	});

	it("shows mcp:off when mcpEnabled is false", () => {
		const out = renderHuman({
			profile: "p",
			url: "u",
			reachable: true,
			version: "0.2.1",
			ready: true,
			workspaces: 0,
			ingest: null,
			mcpEnabled: false,
			mcpUrl: null,
		});
		expect(out).toContain("mcp:        off");
	});

	it("falls back to 'on' for mcpEnabled:true with no baseUrl", () => {
		const out = renderHuman({
			profile: "p",
			url: "u",
			reachable: true,
			version: "0.2.1",
			ready: true,
			workspaces: 0,
			ingest: null,
			mcpEnabled: true,
			mcpUrl: null,
		});
		expect(out).toContain("mcp:        on");
	});
});

describe("probe", () => {
	it("returns the parsed payload on 2xx", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(JSON.stringify({ version: "0.2.1" }), { status: 200 }),
			);
		const result = await probe(
			"http://r/",
			"/version",
			VersionSchema,
			fetchImpl,
		);
		expect(result).toEqual({ version: "0.2.1" });
		expect(fetchImpl).toHaveBeenCalledWith(
			"http://r/version",
			expect.objectContaining({ headers: { Accept: "application/json" } }),
		);
	});

	it("strips trailing slashes on the base URL exactly once", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response('{"version":"x"}', { status: 200 }));
		await probe("http://r///", "/version", VersionSchema, fetchImpl);
		expect(fetchImpl).toHaveBeenCalledWith(
			"http://r/version",
			expect.anything(),
		);
	});

	it("returns null on a non-JSON body", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response("not json", { status: 200 }));
		const result = await probe(
			"http://r",
			"/version",
			VersionSchema,
			fetchImpl,
		);
		expect(result).toBeNull();
	});

	it("returns null when the schema rejects the body", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(
				new Response(JSON.stringify({ status: 123 }), { status: 200 }),
			);
		const result = await probe("http://r", "/readyz", ReadySchema, fetchImpl);
		// status: 123 is not a string per the schema → safeParse fails.
		expect(result).toBeNull();
	});

	it("returns null when fetch rejects (timeout, DNS, refused)", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockRejectedValue(new Error("ECONNREFUSED"));
		const result = await probe(
			"http://nope",
			"/features",
			FeaturesSchema,
			fetchImpl,
		);
		expect(result).toBeNull();
	});
});
