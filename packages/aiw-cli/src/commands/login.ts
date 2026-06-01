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
import { ExitCode } from "../exit-codes.js";
import { HttpError, request } from "../http.js";
import {
	emit,
	fail,
	info,
	parseOutputFormat,
	success,
	warn,
} from "../output.js";
import { WhoAmISchema } from "../types.js";
import { runDeviceFlowLogin } from "./login-oidc.js";

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
				device: z.boolean().optional(),
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
		oidc: {
			type: "boolean",
			description:
				"Use the OIDC device-flow (RFC 8628) login instead of pasting an API key.",
		},
		output: { type: "string", description: "human | json" },
	},
	async run({ args }) {
		const format = parseOutputFormat(args.output);
		const interactive =
			process.stdin.isTTY && !args["api-key"] && format === "human";

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
			process.exit(ExitCode.USAGE_ERROR);
		}

		// OIDC device-flow branch — handed off to a dedicated module
		// because the polling lifecycle is non-trivial. Probes the
		// runtime first so we can fail with an actionable message if
		// the runtime doesn't speak device flow.
		if (args.oidc) {
			const probe = await probeAuthConfig(url);
			if (probe && probe.modes?.device === false) {
				fail(
					"The runtime reports it doesn't support OIDC device flow. Use `aiw login` (API key) instead, or point at a runtime that has OIDC configured with a device-aware IdP.",
				);
				process.exit(ExitCode.USAGE_ERROR);
			}
			// Device flow emits its own human-readable progress; in json
			// mode it stays silent and hands back the same envelope shape
			// the API-key path emits, which we print here for parity.
			const oidcResult = await runDeviceFlowLogin({
				url,
				profileName,
				format,
			});
			if (format === "json") emit(format, oidcResult, () => "");
			return;
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
		if (format === "human") {
			success(`Saved profile "${profileName}" at ${loc.file}.`);
		}

		const result = {
			profile: profileName,
			url,
			configPath: loc.file,
			verified: false as boolean,
			// `null` = the runtime reports this caller as unscoped (all
			// scopes); `undefined` = we never got to verify (no key / skip).
			role: undefined as string | null | undefined,
			scopes: undefined as readonly string[] | null | undefined,
		};

		if (args["no-verify"] || !apiKey) {
			if (format === "human" && !apiKey) {
				info("No API key supplied; skipping /auth/me verification.");
			}
			if (format === "json") emit(format, result, () => "");
			return;
		}

		try {
			const me = await request({ profile }, "/auth/me", WhoAmISchema);
			result.verified = true;
			result.role = me.role;
			result.scopes = me.scopes;
			if (format === "human") {
				success("API key accepted by the runtime.");
				if (me.role) info(`Key role: ${me.role}.`);
			}
		} catch (err: unknown) {
			const msg = `Saved the profile but /auth/me failed: ${describe(err)}.`;
			if (format === "human") {
				fail(msg);
				if (err instanceof HttpError && err.status === 401) {
					info(hintFor401(err.message));
				} else {
					info("Run `aiw whoami` once the runtime is reachable.");
				}
			}
		}
		if (format === "json") emit(format, result, () => "");
	},
});

function describe(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

/**
 * Translate a runtime `403 forbidden` into actionable RBAC guidance —
 * the 403 sibling of {@link hintFor401}. Matches the messages the
 * runtime's authz layer emits (`auth/authz.ts`):
 *
 *   - "missing required scope 'X'"  → the key authenticated but its
 *     role is too low. Name the role that grants the scope so the user
 *     knows what to mint, mirroring the role picker in the web UI.
 *   - "not authorized for workspace 'W'" → the key is scoped to a
 *     different workspace; this isn't a role problem.
 *
 * Returns `null` when the message isn't a recognized authz denial, so
 * the caller falls back to the server-supplied registry hint instead of
 * overriding it with something less specific.
 */
export function hintForForbidden(message: string): string | null {
	const m = message.toLowerCase();
	// Scopes are lowercase with an optional `:` facet (0.5.0 fine grants
	// like `write:ingest` / `manage:keys`), so match the colon too — the
	// pre-0.5.0 `[a-z]+` pattern silently failed to recognize fine-scope
	// denials and fell back to the generic hint.
	const scopeMatch = m.match(/missing required scope '([a-z:]+)'/);
	if (scopeMatch?.[1]) {
		const scope = scopeMatch[1];
		// Map the scope's coarse tier to the role that grants it. Fine scopes
		// share their tier's role; `tools:invoke` is a write-class capability
		// (driving agents to call external tools).
		const tier = scope.split(":")[0] ?? scope;
		const role =
			tier === "manage"
				? "Admin"
				: tier === "write" || tier === "tools"
					? "Editor (or Admin)"
					: "Viewer (or higher)";
		const rolePreset = (role.split(" ")[0] ?? role).toLowerCase();
		const lines = [
			`Your key authenticated but lacks the '${scope}' scope, so the runtime refused this action.`,
			`  • Mint a key that carries it: \`aiw key create <label> --scope ${scope}\` (or \`--role ${rolePreset}\` for the ${role} preset), or via the web UI (Workspace settings → API keys → New key).`,
		];
		if (tier === "manage") {
			lines.push(
				"  • 'manage' is the admin tier: minting/revoking keys, RLAC principals + policy, and workspace deletion. Editor keys can mutate content but not perform these admin ops.",
			);
		}
		return lines.join("\n");
	}
	const wsMatch = m.match(/not authorized for workspace '([^']+)'/);
	if (wsMatch) {
		return [
			`This key isn't scoped to workspace '${wsMatch[1]}'.`,
			"  • API keys are workspace-scoped — mint one under the workspace you're targeting, or switch profiles with `aiw login --profile <name>`.",
		].join("\n");
	}
	return null;
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
