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

/**
 * Marks a matched value as an obvious non-secret sample (a placeholder
 * in docs, a fake test fixture, or a redacted example) rather than a
 * real credential. Real keys are high-entropy and never embed these
 * dictionary words, so dropping matches that contain one keeps the
 * high-entropy/structural rules below false-positive-light WITHOUT
 * needing a `secret-scan: allow` comment on every doc/test line.
 *
 * Only applied to rules that opt in via `skipPlaceholders` — the
 * structural prefix rules (Astra, GitHub, AWS, …) stay strict so a
 * real leak whose value happens to contain "test" is still caught.
 */
const PLACEHOLDER_VALUE =
	/(?:test|example|dummy|fake|placeholder|sample|redacted|your[_-]?|xxx+|changeme|\.\.\.)/i;

const RULES = [
	{
		name: "Astra application token",
		pattern: /AstraCS:[A-Za-z0-9_.:-]{20,}/g,
	},
	{
		name: "OpenRouter API key",
		// 0.4.0 default chat/embedding provider. Keys are
		// `sk-or-v1-<64 hex>`; a dedicated rule (ahead of the generic
		// `sk-` rule) gives a clearer finding label for the credential
		// that now reaches the runtime by default.
		pattern: /sk-or-v1-[A-Za-z0-9]{32,}/g,
	},
	{
		name: "OpenAI secret key",
		// Generic OpenAI-style `sk-...` (also matches `sk-proj-...`).
		// Covers OpenAI BYOK + any OpenAI-compatible provider that mints
		// `sk-` keys; OpenRouter `sk-or-` is caught by the rule above.
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
		name: "Cohere API key",
		// Cohere (default reranking provider) mints 40-char base62
		// tokens with no stable prefix, so a bare-token rule would be
		// far too broad. Match the credential only where it is clearly
		// labelled as a Cohere key — `COHERE_API_KEY=<token>` or a
		// `co_...`-prefixed variant — and skip obvious placeholders.
		pattern: /(?:COHERE_API_KEY\s*[=:]\s*|co_)[A-Za-z0-9]{20,}/g,
		skipPlaceholders: true,
	},
	{
		name: "Bearer token",
		// A hard-coded bearer credential, e.g. `Authorization: Bearer
		// <token>`. The negative lookahead drops interpolations
		// (`Bearer ${apiKey}`, `Bearer {os.environ[...]}`) and
		// angle-bracket placeholders (`Bearer <jwt>`); `skipPlaceholders`
		// drops fake test tokens. Requires a 20+ high-entropy run so
		// short docs examples (`Bearer abc`) never trip.
		pattern: /[Bb]earer\s+(?![<${])[A-Za-z0-9](?:[A-Za-z0-9._~+/=-]){19,}/g,
		skipPlaceholders: true,
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
		name: "Google API key",
		// `AIza<35 chars>` — common shape for Gemini / Google-backed MCP
		// servers and search providers an agent might be wired to.
		pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
	},
	{
		name: "Slack token",
		// `xoxb-`/`xoxp-`/… bot & user tokens — a frequent MCP-server
		// credential shape.
		pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}/g,
		skipPlaceholders: true,
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
				if (rule.skipPlaceholders && PLACEHOLDER_VALUE.test(match[0])) {
					continue;
				}
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
