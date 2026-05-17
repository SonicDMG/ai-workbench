import * as p from "@clack/prompts";
import { defineCommand } from "citty";
import { z } from "zod";
import {
	defaultConfigLocation,
	type Profile,
	readConfig,
	setProfile,
	writeConfig,
} from "../config.js";
import { HttpError, request } from "../http.js";
import { fail, info, success, warn } from "../output.js";
import { WhoAmISchema } from "../types.js";

/**
 * Shape of the runtime's `/auth/config` response. Reports which auth
 * schemes the runtime will accept on the wire so the CLI can warn
 * upfront when a user is about to paste a key into a runtime that
 * isn't configured for `auth.mode: apiKey` or `any`.
 *
 * We only project the bits the CLI uses; new fields land transparently
 * via passthrough().
 */
const AuthConfigSchema = z
	.object({
		modes: z
			.object({
				apiKey: z.boolean().optional(),
				oidc: z.boolean().optional(),
				login: z.boolean().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();
type AuthConfigResponse = z.infer<typeof AuthConfigSchema>;

/**
 * Normalize an API key string before it lands in the config file.
 * Strips surrounding whitespace and a single layer of matching quotes
 * (users routinely paste `"wb_live_..."` from a JSON snippet). Also
 * drops a leading `Bearer ` prefix in case the user copied the full
 * Authorization header.
 */
function normalizeApiKey(raw: string): string {
	let v = raw.trim();
	if (
		(v.startsWith('"') && v.endsWith('"')) ||
		(v.startsWith("'") && v.endsWith("'"))
	) {
		v = v.slice(1, -1).trim();
	}
	if (/^bearer\s+/i.test(v)) {
		v = v.replace(/^bearer\s+/i, "").trim();
	}
	return v;
}

const EXPECTED_KEY_PREFIX = "wb_live_";

export const loginCommand = defineCommand({
	meta: {
		name: "login",
		description: "Save an API key + runtime URL into a profile.",
	},
	args: {
		url: {
			type: "string",
			description: "Runtime base URL (e.g. http://localhost:8080)",
		},
		profile: {
			type: "string",
			description: "Profile name to write to (default: 'default')",
		},
		"api-key": {
			type: "string",
			description: "API key (prompted if omitted; reads stdin when piped)",
		},
		"no-verify": {
			type: "boolean",
			description: "Skip the call to /auth/me after saving credentials",
		},
	},
	async run({ args }) {
		const interactive = process.stdin.isTTY && !args["api-key"];

		const profileName =
			args.profile?.trim() ||
			(interactive
				? ((await p.text({
						message: "Profile name",
						placeholder: "default",
						defaultValue: "default",
					})) as string)
				: "default");

		const url =
			args.url?.trim() ||
			(interactive
				? ((await p.text({
						message: "Runtime URL",
						placeholder: "http://localhost:8080",
						validate: (v) => {
							if (!v) return "Runtime URL is required.";
							try {
								new URL(v);
								return undefined;
							} catch {
								return "Must be a valid URL.";
							}
						},
					})) as string)
				: undefined);

		if (!url) {
			fail("--url is required when stdin is not a TTY.");
			process.exit(2);
		}

		// Probe the runtime's auth modes before we ask for a key. This
		// catches the common dev-loop footgun where `workbench.yaml` has
		// no `auth:` block — the schema default is `auth.mode: disabled`,
		// which makes the resolver reject ANY bearer token with
		// "token did not match any configured auth scheme" and leaves
		// the user staring at an opaque 401. With a probe, we can tell
		// them the runtime simply doesn't accept keys at all.
		const authProbe = await probeAuthConfig(url);
		if (authProbe) {
			const acceptsApiKey = authProbe.modes?.apiKey === true;
			const acceptsOidc = authProbe.modes?.oidc === true;
			if (!acceptsApiKey && !acceptsOidc) {
				warn(
					"Runtime reports `auth.mode: disabled` (no apiKey, no oidc). Any bearer token will be rejected; you can skip the API key prompt and call the runtime anonymously. Set `auth.mode: apiKey` in workbench.yaml if you want key-based auth.",
				);
			} else if (!acceptsApiKey && acceptsOidc) {
				warn(
					"Runtime reports `auth.mode: oidc` only — pasted API keys will be rejected. Mint a key under a runtime configured for `auth.mode: apiKey` or `any`, or use the browser login flow.",
				);
			}
		}

		const rawKey =
			args["api-key"] ||
			(interactive
				? ((await p.password({
						message: "API key (created in the workspace settings)",
						mask: "•",
					})) as string)
				: undefined);

		const apiKey = rawKey ? normalizeApiKey(rawKey) : undefined;

		if (apiKey && !apiKey.startsWith(EXPECTED_KEY_PREFIX)) {
			warn(
				`API key does not start with "${EXPECTED_KEY_PREFIX}". The runtime mints keys in the form "${EXPECTED_KEY_PREFIX}<prefix>_<secret>"; double-check what you pasted if the runtime rejects it.`,
			);
		}

		const profile: Profile = { url, apiKey };
		const loc = defaultConfigLocation();
		const current = await readConfig(loc);
		const next = setProfile(current, profileName, profile);
		await writeConfig(next, loc);
		success(`Saved profile "${profileName}" at ${loc.file}.`);

		if (args["no-verify"]) return;
		if (!apiKey) {
			info("No API key supplied; skipping /auth/me verification.");
			return;
		}

		try {
			await request({ profile }, "/auth/me", WhoAmISchema);
			success("API key accepted by the runtime.");
		} catch (err: unknown) {
			fail(`Saved the profile but /auth/me failed: ${describe(err)}.`);
			if (err instanceof HttpError && err.status === 401) {
				info(hintFor401(err.message));
			} else {
				info("Run `aiw whoami` once the runtime is reachable.");
			}
		}
	},
});

function describe(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

/**
 * Translate the runtime's auth-resolver messages into actionable
 * guidance. Matches the strings emitted by `auth/resolver.ts` and
 * `auth/apiKey/verifier.ts` so the CLI can point users at the most
 * likely fix instead of just echoing the server error.
 */
function hintFor401(message: string): string {
	const m = message.toLowerCase();
	if (m.includes("did not match any configured auth scheme")) {
		return [
			"The runtime rejected the bearer token. Likely causes:",
			"  • the runtime is in `auth.mode: disabled` (the schema default; set by `npm run dev` when workbench.yaml has no `auth:` block) — no verifier exists, so every bearer token fails. Run `aiw login` again with no API key, OR add `auth: { mode: apiKey }` to runtimes/typescript/workbench.yaml",
			`  • the pasted key doesn't start with "${EXPECTED_KEY_PREFIX}" (full form: ${EXPECTED_KEY_PREFIX}<prefix>_<secret>)`,
			"  • the runtime is in `auth.mode: oidc` only — mint a key under a runtime configured for apiKey or `any`",
			"  • whitespace, quotes, or a `Bearer ` prefix sneaked in (the CLI now trims these — re-run `aiw login`)",
		].join("\n");
	}
	if (m.includes("api key not recognized")) {
		return "No API key with that prefix exists in the runtime's control plane. Was it minted against a different workspace or runtime?";
	}
	if (m.includes("revoked")) {
		return "This API key was revoked. Mint a fresh one in the web UI under Workspace settings → API keys.";
	}
	if (m.includes("expired")) {
		return "This API key has expired. Mint a fresh one.";
	}
	if (m.includes("digest did not match")) {
		return "The token prefix matched a stored key but the secret didn't. The pasted value is likely truncated or has been tampered with.";
	}
	return "Run `aiw whoami` once the runtime is reachable.";
}

/**
 * Probe `/auth/config` (which is always anonymous-allow, even under
 * `anonymousPolicy: reject`, because the UI calls it before it has
 * any credentials) and return the auth-mode summary. Returns `null`
 * when the endpoint is unreachable or returns a non-JSON shape — the
 * caller treats that as "couldn't determine" and falls back to the
 * normal flow.
 */
async function probeAuthConfig(
	url: string,
): Promise<AuthConfigResponse | null> {
	try {
		const res = await fetch(`${url.replace(/\/+$/, "")}/auth/config`, {
			headers: { Accept: "application/json" },
		});
		if (!res.ok) return null;
		const body = await res.json();
		const parsed = AuthConfigSchema.safeParse(body);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}
