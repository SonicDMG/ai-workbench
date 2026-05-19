#!/usr/bin/env node
/**
 * One-time helper: flip the GHCR container package
 * `ghcr.io/datastax/ai-workbench` from private (the default for new
 * GHCR packages) to public, so `docker pull` works without auth.
 *
 * GitHub creates the package the first time the release workflow
 * pushes an image. Until then there is nothing to flip and this
 * script exits with a hint.
 *
 * After a successful release:
 *
 *   node scripts/ghcr-make-public.mjs
 *   # or: npm run release:make-public
 *
 * Prerequisites:
 *   - `gh` CLI installed and authenticated as a member of the
 *     `datastax` org with package-admin rights.
 *   - The CLI token needs `admin:packages` scope (not just the
 *     default `packages: write` that the release workflow uses).
 *     Refresh once with:  gh auth refresh -s admin:packages
 *
 * Idempotent: a re-run on an already-public package is a no-op.
 */

import { spawnSync } from "node:child_process";

const ORG = "datastax";
const PACKAGE = "ai-workbench";
const ENDPOINT = `/orgs/${ORG}/packages/container/${PACKAGE}`;

function gh(args, { allowFail = false } = {}) {
	const result = spawnSync("gh", args, { encoding: "utf8" });
	if (result.error) {
		console.error(`Failed to run gh: ${result.error.message}`);
		console.error(
			"Install from https://cli.github.com or run `brew install gh`.",
		);
		process.exit(2);
	}
	if (result.status !== 0 && !allowFail) {
		console.error(result.stderr.trim() || `gh exited ${result.status}`);
		process.exit(result.status ?? 1);
	}
	return result;
}

function explain403(stderr) {
	if (/admin:packages|read:packages/i.test(stderr)) {
		console.error(
			"\nThe gh token is missing the admin:packages scope. Refresh with:",
		);
		console.error("  gh auth refresh -s admin:packages\n");
	}
}

// 1. Fetch current state. 404 = package doesn't exist yet.
const get = gh(["api", ENDPOINT], { allowFail: true });
if (get.status !== 0) {
	if (/Package not found/i.test(get.stderr)) {
		console.error(
			`No GHCR package at ghcr.io/${ORG}/${PACKAGE} yet — ` +
				"the release workflow hasn't published an image.",
		);
		console.error(
			"Tag a release (vX.Y.Z) to trigger .github/workflows/release.yml, " +
				"then re-run this script.",
		);
		process.exit(1);
	}
	console.error(get.stderr.trim());
	explain403(get.stderr);
	process.exit(get.status ?? 1);
}

const pkg = JSON.parse(get.stdout);
console.log(
	`Package ghcr.io/${ORG}/${PACKAGE} — current visibility: ${pkg.visibility}`,
);

if (pkg.visibility === "public") {
	console.log("Already public. Nothing to do.");
	process.exit(0);
}

// 2. Flip to public.
const patch = gh(
	["api", "--method", "PATCH", ENDPOINT, "-f", "visibility=public"],
	{ allowFail: true },
);
if (patch.status !== 0) {
	console.error(patch.stderr.trim());
	explain403(patch.stderr);
	process.exit(patch.status ?? 1);
}

// 3. Verify.
const verify = JSON.parse(gh(["api", ENDPOINT]).stdout);
if (verify.visibility !== "public") {
	console.error(
		`Visibility is still ${verify.visibility} after PATCH — investigate manually at ` +
			`https://github.com/orgs/${ORG}/packages/container/package/${PACKAGE}/settings`,
	);
	process.exit(1);
}
console.log("Flipped to public. `docker pull` now works without auth.");
