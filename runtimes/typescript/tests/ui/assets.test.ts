import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { buildUiAssets, isSpaPath, resolveUiDir } from "../../src/ui/assets.js";

describe("isSpaPath", () => {
	test("root, nested, and uuid-like paths are SPA routes", () => {
		expect(isSpaPath("/")).toBe(true);
		expect(isSpaPath("/onboarding")).toBe(true);
		expect(isSpaPath("/workspaces/abc123")).toBe(true);
		expect(isSpaPath("/workspaces/550e8400-e29b-41d4-a716-446655440000")).toBe(
			true,
		);
	});

	test("API, docs, and operational routes are excluded", () => {
		expect(isSpaPath("/api")).toBe(false);
		expect(isSpaPath("/api/")).toBe(false);
		expect(isSpaPath("/api/v1/workspaces")).toBe(false);
		expect(isSpaPath("/docs")).toBe(false);
		expect(isSpaPath("/docs/something")).toBe(false);
		expect(isSpaPath("/healthz")).toBe(false);
		expect(isSpaPath("/readyz")).toBe(false);
		expect(isSpaPath("/version")).toBe(false);
	});

	test("paths that look like asset requests are excluded", () => {
		expect(isSpaPath("/favicon.ico")).toBe(false);
		expect(isSpaPath("/assets/index.js")).toBe(false);
		expect(isSpaPath("/foo/bar.css")).toBe(false);
	});
});

describe("resolveUiDir", () => {
	let tmp: string;
	const originalCwd = process.cwd();
	const originalEnv = process.env.UI_DIR;

	beforeEach(() => {
		// realpath() to sidestep macOS's /var → /private/var symlink,
		// which otherwise makes `process.cwd()`-based candidates
		// inequal to the path we created.
		tmp = realpathSync(mkdtempSync(join(tmpdir(), "wb-ui-")));
	});
	afterEach(() => {
		process.chdir(originalCwd);
		if (originalEnv === undefined) delete process.env.UI_DIR;
		else process.env.UI_DIR = originalEnv;
		rmSync(tmp, { recursive: true, force: true });
	});

	test("returns null when nothing is configured and no candidates exist", () => {
		process.chdir(tmp);
		delete process.env.UI_DIR;
		expect(resolveUiDir(null)).toBe(null);
	});

	test("honors an explicit absolute dir when it has index.html", () => {
		writeFileSync(join(tmp, "index.html"), "<!doctype html><html></html>");
		expect(resolveUiDir(tmp)).toBe(tmp);
	});

	test("returns null for an explicit dir that lacks index.html", () => {
		expect(resolveUiDir(tmp)).toBe(null);
	});

	test("UI_DIR env acts as an override when config is null", () => {
		writeFileSync(join(tmp, "index.html"), "<!doctype html>");
		process.env.UI_DIR = tmp;
		expect(resolveUiDir(null)).toBe(tmp);
	});

	test("auto-detects apps/web/dist under CWD", () => {
		const dist = join(tmp, "apps", "web", "dist");
		mkdirSync(dist, { recursive: true });
		writeFileSync(join(dist, "index.html"), "<!doctype html>");
		process.chdir(tmp);
		delete process.env.UI_DIR;
		expect(resolveUiDir(null)).toBe(dist);
	});
});

describe("buildUiAssets", () => {
	let tmp: string;
	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "wb-ui-"));
		writeFileSync(
			join(tmp, "index.html"),
			'<!doctype html><html><body><div id="root"></div></body></html>',
		);
	});
	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	test("reads index.html into a SPA fallback that produces HTML 200", () => {
		const assets = buildUiAssets(tmp);
		expect(assets.dir).toBe(tmp);
		const fakeCtx = {
			html: (body: string) => new Response(body, { status: 200 }),
		} as unknown as Parameters<typeof assets.spaFallback>[0];
		const res = assets.spaFallback(fakeCtx);
		expect(res.status).toBe(200);
	});
});
