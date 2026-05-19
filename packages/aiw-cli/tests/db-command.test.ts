/**
 * End-to-end tests for `aiw db workbench` and `aiw db ingest`.
 *
 * `workbench` is offline — we assert it prints (and serialises to
 * JSON) the right URL for the active profile. `ingest` is wired
 * through a tiny in-process http stub that mimics the runtime's
 * `POST /api/v1/workspaces/:ws/knowledge-bases/:kb/ingest/file` and
 * returns either the sync `{document,chunks}` envelope or the async
 * `{job}` envelope.
 */
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const binary = resolve(here, "..", "dist", "cli.js");
const hasBuild = existsSync(binary);

interface SpawnResult {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

async function readAll(stream: NodeJS.ReadableStream | null): Promise<string> {
	if (!stream) return "";
	const chunks: Buffer[] = [];
	for await (const chunk of stream) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf8");
}

async function run(
	args: readonly string[],
	env: NodeJS.ProcessEnv,
): Promise<SpawnResult> {
	const child = spawn(process.execPath, [binary, ...args], {
		env: { ...process.env, ...env },
		stdio: ["ignore", "pipe", "pipe"],
	});
	const [stdout, stderr, code] = await Promise.all([
		readAll(child.stdout),
		readAll(child.stderr),
		new Promise<number | null>((res, rej) => {
			child.on("error", rej);
			child.on("close", (c) => res(c));
		}),
	]);
	return { code, stdout, stderr };
}

interface CapturedIngest {
	url: string;
	contentType: string;
	bodyBytes: Buffer;
}

interface RuntimeStubOptions {
	readonly workspaces?: ReadonlyArray<{
		readonly workspaceId: string;
		readonly name: string;
		readonly url?: string;
	}>;
	readonly knowledgeBases?: Record<
		string,
		ReadonlyArray<{
			readonly knowledgeBaseId: string;
			readonly name: string;
		}>
	>;
	readonly ingestResponse?: Record<string, unknown>;
}

interface RuntimeStub {
	readonly url: string;
	readonly capturedIngest: CapturedIngest[];
	stop(): Promise<void>;
}

function runtimeStub(
	apiKey: string,
	opts: RuntimeStubOptions = {},
): Promise<RuntimeStub> {
	const captured: CapturedIngest[] = [];
	const workspaces = opts.workspaces ?? [];
	const server: Server = createServer(async (req, res) => {
		const auth = req.headers.authorization;
		if (auth !== `Bearer ${apiKey}`) {
			res.writeHead(401, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: { code: "unauthorized", message: "" } }));
			return;
		}
		if (req.method === "GET" && req.url === "/api/v1/workspaces") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ items: workspaces, nextCursor: null }));
			return;
		}
		const kbMatch =
			req.method === "GET" &&
			req.url?.match(/^\/api\/v1\/workspaces\/([^/]+)\/knowledge-bases$/);
		if (kbMatch) {
			const wsId = decodeURIComponent(kbMatch[1] ?? "");
			const items = opts.knowledgeBases?.[wsId] ?? [];
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ items, nextCursor: null }));
			return;
		}
		if (req.method === "POST" && req.url?.includes("/ingest/file")) {
			const bodyBytes = await collectBody(req);
			captured.push({
				url: req.url,
				contentType: req.headers["content-type"] ?? "",
				bodyBytes,
			});
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify(opts.ingestResponse ?? {}));
			return;
		}
		res.writeHead(404, { "content-type": "application/json" });
		res.end(JSON.stringify({ error: { code: "not_found", message: req.url } }));
	});

	return new Promise((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address() as AddressInfo;
			resolveListen({
				url: `http://127.0.0.1:${addr.port}`,
				capturedIngest: captured,
				async stop() {
					await new Promise<void>((r) => server.close(() => r()));
				},
			});
		});
	});
}

async function collectBody(req: IncomingMessage): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

async function seedConfig(
	home: string,
	url: string,
	apiKey: string,
): Promise<void> {
	await mkdir(join(home, ".aiw"), { recursive: true });
	writeFileSync(
		join(home, ".aiw", "config.json"),
		JSON.stringify({
			active: "default",
			profiles: { default: { url, apiKey } },
		}),
		{ mode: 0o600 },
	);
}

const ENV_BASE = {
	AIW_PROFILE: "",
	AIW_API_URL: "",
	AIW_API_KEY: "",
};

describe.skipIf(!hasBuild)("aiw db workbench", () => {
	let tmpHome: string;
	let stub: RuntimeStub;
	const apiKey = "wb_dbcmd_testtoken_supersecret";

	beforeEach(async () => {
		tmpHome = await mkdtemp(join(tmpdir(), "aiw-db-wb-"));
		stub = await runtimeStub(apiKey, {
			workspaces: [
				{
					workspaceId: "ws_mydb_123",
					name: "mydb",
					url: "astra-cli:erichare:c933e7fc-4996-4dcd-bb87-4f282fe1e7ef:endpoint",
				},
				{
					workspaceId: "ws_other_456",
					name: "other",
					url: "astra-cli:erichare:11111111-2222-3333-4444-555555555555:endpoint",
				},
			],
		});
		await seedConfig(tmpHome, stub.url, apiKey);
	});

	afterEach(async () => {
		await stub.stop();
		await rm(tmpHome, { recursive: true, force: true });
	});

	it("resolves the db name to a workspace and deep-links to /workspaces/<id>", async () => {
		const r = await run(["db", "workbench", "mydb", "--output", "json"], {
			HOME: tmpHome,
			USERPROFILE: tmpHome,
			...ENV_BASE,
		});
		expect(r.code).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.db).toBe("mydb");
		expect(parsed.workspaceId).toBe("ws_mydb_123");
		expect(parsed.matchedBy).toBe("name");
		expect(parsed.url).toBe(`${stub.url}/workspaces/ws_mydb_123`);
		expect(parsed.lookupError).toBeNull();
	});

	it("matches by url substring (e.g. Astra DB UUID)", async () => {
		const r = await run(
			[
				"db",
				"workbench",
				"c933e7fc-4996-4dcd-bb87-4f282fe1e7ef",
				"--output",
				"json",
			],
			{ HOME: tmpHome, USERPROFILE: tmpHome, ...ENV_BASE },
		);
		expect(r.code).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.workspaceId).toBe("ws_mydb_123");
		expect(parsed.matchedBy).toBe("url-substring");
	});

	it("matches by workspace ID directly", async () => {
		const r = await run(
			["db", "workbench", "ws_mydb_123", "--output", "json"],
			{ HOME: tmpHome, USERPROFILE: tmpHome, ...ENV_BASE },
		);
		expect(r.code).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.workspaceId).toBe("ws_mydb_123");
		expect(parsed.matchedBy).toBe("id");
	});

	it("--workspace overrides the name lookup", async () => {
		const r = await run(
			[
				"db",
				"workbench",
				"mydb",
				"--workspace",
				"ws_forced",
				"--output",
				"json",
			],
			{ HOME: tmpHome, USERPROFILE: tmpHome, ...ENV_BASE },
		);
		expect(r.code).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.workspaceId).toBe("ws_forced");
		expect(parsed.matchedBy).toBe("flag");
		expect(parsed.url).toBe(`${stub.url}/workspaces/ws_forced`);
	});

	it("falls back to the ?db= URL and warns when no workspace matches", async () => {
		const r = await run(["db", "workbench", "bogus", "--output", "json"], {
			HOME: tmpHome,
			USERPROFILE: tmpHome,
			...ENV_BASE,
		});
		expect(r.code).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.workspaceId).toBeNull();
		expect(parsed.matchedBy).toBeNull();
		const url = new URL(parsed.url);
		expect(url.searchParams.get("db")).toBe("bogus");
	});

	it("falls back gracefully when the runtime is unreachable", async () => {
		await stub.stop();
		const r = await run(["db", "workbench", "mydb", "--output", "json"], {
			HOME: tmpHome,
			USERPROFILE: tmpHome,
			...ENV_BASE,
		});
		expect(r.code).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.workspaceId).toBeNull();
		expect(parsed.lookupError).toBeTruthy();
		const url = new URL(parsed.url);
		expect(url.searchParams.get("db")).toBe("mydb");
	});

	it("falls back to the bare runtime URL when no db is supplied", async () => {
		const r = await run(["db", "workbench", "--output", "json"], {
			HOME: tmpHome,
			USERPROFILE: tmpHome,
			...ENV_BASE,
		});
		expect(r.code).toBe(0);
		const parsed = JSON.parse(r.stdout);
		expect(parsed.db).toBeNull();
		expect(parsed.workspaceId).toBeNull();
		expect(parsed.url).toBe(stub.url);
	});
});

describe.skipIf(!hasBuild)("aiw db ingest", () => {
	let tmpHome: string;
	let stub: RuntimeStub;
	let uploadPath: string;
	const apiKey = "wb_dbcmd_ingest_testtoken_supersecret";

	beforeEach(async () => {
		tmpHome = await mkdtemp(join(tmpdir(), "aiw-db-ingest-"));
		uploadPath = join(tmpHome, "mydoc.pdf");
		await writeFile(uploadPath, "%PDF-1.4 fake-bytes\n");
		stub = await runtimeStub(apiKey, {
			workspaces: [
				{
					workspaceId: "ws_mydb_123",
					name: "mydb",
					url: "astra-cli:erichare:c933e7fc:endpoint",
				},
			],
			knowledgeBases: {
				ws_mydb_123: [
					{ knowledgeBaseId: "kb_support_abc", name: "Support" },
					{ knowledgeBaseId: "kb_other_xyz", name: "Other" },
				],
				ws_1: [],
			},
			ingestResponse: {
				document: { documentId: "doc_abc", sourceFilename: "mydoc.pdf" },
				chunks: 3,
			},
		});
		await seedConfig(tmpHome, stub.url, apiKey);
	});

	afterEach(async () => {
		await stub.stop();
		await rm(tmpHome, { recursive: true, force: true });
	});

	it("posts a multipart upload to the workspace+kb route and reports the document id", async () => {
		const r = await run(
			[
				"db",
				"ingest",
				"my_db",
				"--workspace",
				"ws_1",
				"--knowledge-base",
				"kb_1",
				"--file",
				uploadPath,
				"--output",
				"json",
			],
			{ HOME: tmpHome, USERPROFILE: tmpHome, ...ENV_BASE },
		);
		expect(r.code).toBe(0);
		expect(stub.capturedIngest).toHaveLength(1);
		const got = stub.capturedIngest[0];
		if (!got) throw new Error("ingest stub captured nothing");
		expect(got.url).toBe(
			"/api/v1/workspaces/ws_1/knowledge-bases/kb_1/ingest/file",
		);
		expect(got.contentType.toLowerCase()).toContain("multipart/form-data");
		const body = got.bodyBytes.toString("utf8");
		expect(body).toContain("mydoc.pdf");
		expect(body).toContain("astraDb");
		expect(body).toContain("my_db");
		const parsed = JSON.parse(r.stdout);
		expect(parsed.document.documentId).toBe("doc_abc");
		expect(parsed.chunks).toBe(3);
	});

	it("accepts --kb as an alias for --knowledge-base", async () => {
		const r = await run(
			[
				"db",
				"ingest",
				"--workspace",
				"ws_1",
				"--kb",
				"kb_1",
				"--file",
				uploadPath,
			],
			{ HOME: tmpHome, USERPROFILE: tmpHome, ...ENV_BASE },
		);
		expect(r.code).toBe(0);
		expect(stub.capturedIngest).toHaveLength(1);
	});

	it("fails with a clear error when --file is missing", async () => {
		const r = await run(
			["db", "ingest", "my_db", "--workspace", "ws_1", "--kb", "kb_1"],
			{ HOME: tmpHome, USERPROFILE: tmpHome, ...ENV_BASE },
		);
		expect(r.code).not.toBe(0);
		expect(r.stderr).toContain("--file");
	});

	it("auto-resolves workspace from the db positional when --workspace is omitted", async () => {
		const r = await run(
			[
				"db",
				"ingest",
				"mydb",
				"--knowledge-base",
				"kb_support_abc",
				"--file",
				uploadPath,
			],
			{ HOME: tmpHome, USERPROFILE: tmpHome, ...ENV_BASE },
		);
		expect(r.code).toBe(0);
		expect(stub.capturedIngest).toHaveLength(1);
		const got = stub.capturedIngest[0];
		if (!got) throw new Error("ingest stub captured nothing");
		expect(got.url).toBe(
			"/api/v1/workspaces/ws_mydb_123/knowledge-bases/kb_support_abc/ingest/file",
		);
		expect(r.stderr).toContain("resolved db");
	});

	it("auto-resolves the KB by name to its UUID", async () => {
		const r = await run(
			[
				"db",
				"ingest",
				"mydb",
				"--knowledge-base",
				"Support",
				"--file",
				uploadPath,
			],
			{ HOME: tmpHome, USERPROFILE: tmpHome, ...ENV_BASE },
		);
		expect(r.code).toBe(0);
		const got = stub.capturedIngest[0];
		if (!got) throw new Error("ingest stub captured nothing");
		expect(got.url).toBe(
			"/api/v1/workspaces/ws_mydb_123/knowledge-bases/kb_support_abc/ingest/file",
		);
		expect(r.stderr).toContain('resolved kb "Support"');
	});

	it("fails with a clear error when no db is supplied and --workspace is missing", async () => {
		const r = await run(
			["db", "ingest", "--kb", "kb_support_abc", "--file", uploadPath],
			{ HOME: tmpHome, USERPROFILE: tmpHome, ...ENV_BASE },
		);
		expect(r.code).not.toBe(0);
		expect(r.stderr).toContain("--workspace");
	});

	it("fails with a clear error when the db cannot be resolved to a workspace", async () => {
		const r = await run(
			["db", "ingest", "bogus", "--kb", "kb_support_abc", "--file", uploadPath],
			{ HOME: tmpHome, USERPROFILE: tmpHome, ...ENV_BASE },
		);
		expect(r.code).not.toBe(0);
		expect(r.stderr).toContain("could not resolve");
	});

	it("fails with a clear error when --knowledge-base/--kb is missing", async () => {
		const r = await run(
			["db", "ingest", "mydb", "--workspace", "ws_1", "--file", uploadPath],
			{ HOME: tmpHome, USERPROFILE: tmpHome, ...ENV_BASE },
		);
		expect(r.code).not.toBe(0);
		expect(r.stderr).toContain("--knowledge-base");
	});
});
