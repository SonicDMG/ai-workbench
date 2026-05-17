/**
 * CLI live-API smoke against a fake runtime.
 *
 * Extends the subprocess pattern from `cli-smoke.test.ts` to drive
 * the compiled `aiw` binary through a real authenticated round-trip:
 *   1. Stand up a Node `http` stub mimicking the runtime endpoints
 *      the CLI hits (`/auth/config`, `/auth/me`, `/api/v1/workspaces`).
 *   2. Seed `~/.aiw/config.json` under a temp $HOME so the CLI picks
 *      it up without an interactive login.
 *   3. Run `aiw workspace list --output=json` and assert the parsed
 *      envelope matches what the stub served.
 *
 * Catches regressions the unit tests miss — bearer-header wiring,
 * config-file precedence, the actual JSON output format the binary
 * prints to stdout. Mirrors `cli-smoke.test.ts`'s skip-if-no-build
 * pattern so a fresh checkout passes without `npm run build`.
 */

import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";

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
	env: NodeJS.ProcessEnv = {},
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

interface FakeRuntime {
	readonly url: string;
	readonly headers: Record<string, string | undefined>;
	stop(): Promise<void>;
}

function fakeRuntime(
	apiKey: string,
	workspaces: ReadonlyArray<{
		readonly workspaceId: string;
		readonly name: string;
		readonly kind: string;
	}>,
): Promise<FakeRuntime> {
	const lastHeaders: Record<string, string | undefined> = {};
	const server: Server = createServer((req, res) => {
		// Capture the most-recent auth header so the test can assert
		// the CLI sent a bearer with the seeded key.
		const auth = req.headers.authorization;
		if (typeof auth === "string") lastHeaders.authorization = auth;

		const url = req.url ?? "/";

		if (url === "/auth/config") {
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ modes: { apiKey: true, login: false } }));
			return;
		}

		// /auth/me requires bearer; mirrors the runtime's verifier.
		if (url === "/auth/me") {
			if (auth !== `Bearer ${apiKey}`) {
				res.writeHead(401, { "content-type": "application/json" });
				res.end(
					JSON.stringify({
						error: {
							code: "unauthorized",
							message: "token did not match any configured auth scheme",
						},
					}),
				);
				return;
			}
			res.writeHead(200, { "content-type": "application/json" });
			res.end(
				JSON.stringify({
					id: "test-key",
					label: "Test key",
					type: "apiKey",
					scopes: ["read", "write"],
				}),
			);
			return;
		}

		if (url === "/api/v1/workspaces") {
			if (auth !== `Bearer ${apiKey}`) {
				res.writeHead(401, { "content-type": "application/json" });
				res.end(
					JSON.stringify({ error: { code: "unauthorized", message: "no" } }),
				);
				return;
			}
			res.writeHead(200, { "content-type": "application/json" });
			res.end(JSON.stringify({ items: workspaces, nextCursor: null }));
			return;
		}

		res.writeHead(404, { "content-type": "application/json" });
		res.end(
			JSON.stringify({
				error: { code: "not_found", message: `no stub for ${url}` },
			}),
		);
	});

	return new Promise((resolveListen, reject) => {
		server.once("error", reject);
		// Port 0 -> OS assigns a free port; avoids cross-spec port
		// collisions and the parallel-test footgun.
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address() as AddressInfo;
			resolveListen({
				url: `http://127.0.0.1:${addr.port}`,
				headers: lastHeaders,
				async stop() {
					await new Promise<void>((r) => server.close(() => r()));
				},
			});
		});
	});
}

describe.skipIf(!hasBuild)("aiw binary live-API smoke", () => {
	let tmpHome: string;
	let stub: FakeRuntime;
	const apiKey = "wb_live_testtoken12345_supersecret67890";
	const fixtureWorkspaces = [
		{
			workspaceId: "11111111-2222-4333-8444-555555555555",
			name: "fixture-ws",
			kind: "mock",
		},
	];

	beforeAll(async () => {
		stub = await fakeRuntime(apiKey, fixtureWorkspaces);
	});

	afterAll(async () => {
		await stub.stop();
	});

	beforeEach(async () => {
		tmpHome = await mkdtemp(join(tmpdir(), "aiw-cli-live-"));
		// Seed a profile non-interactively so the binary picks it up on
		// boot without prompting. Mode is set by the CLI's own
		// `setProfile` flow at write time; tests just need the file to
		// exist and be parseable.
		await mkdir(join(tmpHome, ".aiw"), { recursive: true });
		writeFileSync(
			join(tmpHome, ".aiw", "config.json"),
			JSON.stringify({
				active: "default",
				profiles: {
					default: {
						url: stub.url,
						apiKey,
					},
				},
			}),
			{ mode: 0o600 },
		);
	});

	afterEach(async () => {
		await rm(tmpHome, { recursive: true, force: true });
	});

	it("workspace list parses the runtime's { items, nextCursor } envelope", async () => {
		const r = await run(["workspace", "list", "--output", "json"], {
			HOME: tmpHome,
			USERPROFILE: tmpHome,
			AIW_PROFILE: "",
			AIW_API_URL: "",
			AIW_API_KEY: "",
		});
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);
		// JSON output mode emits a single parseable document.
		const parsed = JSON.parse(r.stdout) as Array<{
			workspaceId: string;
			name: string;
			kind: string;
		}>;
		expect(parsed).toHaveLength(1);
		expect(parsed[0]?.workspaceId).toBe(fixtureWorkspaces[0]?.workspaceId);
		expect(parsed[0]?.name).toBe("fixture-ws");
		expect(parsed[0]?.kind).toBe("mock");
		// The stub recorded the bearer header — proves the CLI signed
		// the request with the seeded key, not some empty / wrong shape.
		expect(stub.headers.authorization).toBe(`Bearer ${apiKey}`);
	});

	it("whoami round-trips the /auth/me envelope", async () => {
		const r = await run(["whoami", "--output", "json"], {
			HOME: tmpHome,
			USERPROFILE: tmpHome,
			AIW_PROFILE: "",
			AIW_API_URL: "",
			AIW_API_KEY: "",
		});
		expect(r.code, `stderr: ${r.stderr}`).toBe(0);
		const parsed = JSON.parse(r.stdout) as {
			id?: string;
			label?: string;
			type?: string;
		};
		expect(parsed.type).toBe("apiKey");
		expect(parsed.label).toBe("Test key");
	});

	it("surfaces a 401 from /auth/me as a non-zero exit with actionable stderr", async () => {
		// Overwrite the profile with a wrong key so the stub denies
		// /auth/me — same path the user lands in when their saved key
		// has been rotated server-side.
		writeFileSync(
			join(tmpHome, ".aiw", "config.json"),
			JSON.stringify({
				active: "default",
				profiles: { default: { url: stub.url, apiKey: "wb_live_wrong_key" } },
			}),
			{ mode: 0o600 },
		);
		const r = await run(["whoami", "--output", "json"], {
			HOME: tmpHome,
			USERPROFILE: tmpHome,
			AIW_PROFILE: "",
			AIW_API_URL: "",
			AIW_API_KEY: "",
		});
		expect(r.code).not.toBe(0);
		// 0.1.0 added 401-translation guidance — keep that contract here.
		expect(r.stderr.toLowerCase()).toMatch(/auth|401|key|login/);
	});
});
