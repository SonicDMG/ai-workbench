#!/usr/bin/env node
/**
 * Lightweight secret scanner for CI.
 *
 * This intentionally scans tracked files only and avoids third-party actions
 * that require an organization license. If a test fixture must contain a fake
 * token, add `secret-scan: allow` on the same line.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ALLOW_COMMENT = "secret-scan: allow";
const MAX_BYTES = 2 * 1024 * 1024;

const SKIPPED_PATHS = new Set([
	"package-lock.json",
	"apps/web/package-lock.json",
	"runtimes/typescript/package-lock.json",
	"site/package-lock.json",
]);

const SKIPPED_EXTENSIONS = new Set([
	".gif",
	".ico",
	".jpg",
	".jpeg",
	".pdf",
	".png",
	".webp",
	".zip",
]);

const RULES = [
	{
		name: "Astra application token",
		pattern: /AstraCS:[A-Za-z0-9_.:-]{20,}/g,
	},
	{
		name: "OpenAI secret key",
		pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
	},
	{
		name: "Anthropic API key",
		// `sk-ant-api03-...` and historical variants. The trailing
		// segment is base64-ish + dashes/underscores; cap at 20+ to
		// avoid matching the literal `sk-ant-` prefix in docs.
		pattern: /sk-ant-(?:api\d+-)?[A-Za-z0-9_-]{20,}/g,
	},
	{
		name: "HuggingFace user access token",
		// HF tokens are `hf_<35-40 alnum>`. `\b` boundary keeps URLs
		// like `https://hf_co/...` (which never appear in practice but
		// match the prefix) from triggering.
		pattern: /\bhf_[A-Za-z0-9]{30,}\b/g,
	},
	{
		name: "AWS access key id",
		// `AKIA*` is the long-lived IAM user credential prefix. Other
		// AWS prefixes (`ASIA` for STS, `AROA` for roles) are
		// deliberately not matched — `AKIA` is the only one that
		// commonly leaks in source.
		pattern: /\bAKIA[0-9A-Z]{16}\b/g,
	},
	{
		name: "GitHub token",
		pattern: /gh[pousr]_[A-Za-z0-9_]{30,}/g,
	},
	{
		name: "Workbench live API key",
		pattern: /wb_live_[a-z0-9]{12}_[a-z0-9]{32}/g,
	},
	{
		name: "Private key",
		pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
	},
];

function trackedFiles() {
	const output = execFileSync("git", ["ls-files", "-z"], {
		encoding: "utf8",
		maxBuffer: 32 * 1024 * 1024,
	});
	return output.split("\0").filter(Boolean);
}

function shouldSkip(path) {
	if (SKIPPED_PATHS.has(path)) return true;
	const lower = path.toLowerCase();
	for (const extension of SKIPPED_EXTENSIONS) {
		if (lower.endsWith(extension)) return true;
	}
	return false;
}

function mask(value) {
	if (value.length <= 12) return "[redacted]";
	return `${value.slice(0, 6)}...[redacted]...${value.slice(-4)}`;
}

const findings = [];

for (const file of trackedFiles()) {
	if (shouldSkip(file)) continue;

	let content;
	try {
		const bytes = readFileSync(file);
		if (bytes.length > MAX_BYTES || bytes.includes(0)) continue;
		content = bytes.toString("utf8");
	} catch {
		continue;
	}

	const lines = content.split(/\r?\n/);
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		if (line.includes(ALLOW_COMMENT)) continue;

		for (const rule of RULES) {
			for (const match of line.matchAll(rule.pattern)) {
				findings.push({
					file,
					line: index + 1,
					rule: rule.name,
					match: mask(match[0]),
				});
			}
		}
	}
}

if (findings.length > 0) {
	console.error("Potential secrets found in tracked files:\n");
	for (const finding of findings) {
		console.error(
			`  ${finding.file}:${finding.line}  ${finding.rule}  ${finding.match}`,
		);
	}
	console.error(
		`\nFor verified fake test fixtures only, add '${ALLOW_COMMENT}' on the same line.`,
	);
	process.exit(1);
}

console.log("No likely secrets found in tracked files.");
