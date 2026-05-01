/**
 * Startup-time secret presence check.
 *
 * Walks the loaded `Config` for every secret reference (auth session
 * cookie, OIDC client secret, Astra control-plane token, chat token,
 * seed-workspace credentials, etc.) and asks the resolver to fetch each
 * one. Missing or unresolvable secrets fail the boot here instead of at
 * first use minutes into a request — operator visibility, not runtime
 * fragility.
 *
 * Per-workspace user-supplied secret refs (created by the API) are NOT
 * checked here; those are operator data, not deploy config.
 */

import type { Config } from "../config/schema.js";
import type { SecretRef } from "../control-plane/types.js";
import type { Logger } from "../lib/logger.js";
import type { SecretResolver } from "./provider.js";

/** A single missing-or-unresolvable secret reference. */
export interface MissingSecret {
	readonly path: string;
	readonly ref: SecretRef;
	readonly reason: string;
}

export interface PreflightOptions {
	readonly logger?: Pick<Logger, "info" | "warn">;
	/**
	 * When true, missing seed-workspace credentials are warnings rather
	 * than fatal errors. Seeds are convenience entries — a missing token
	 * is annoying but not a deployment-breaking problem (the API
	 * surface still works for other workspaces).
	 */
	readonly seedSecretsAdvisory?: boolean;
}

/**
 * Collect every `*Ref` field in the config that needs to resolve at
 * startup. Returns `{ path, ref }` pairs for each so the caller can
 * report the configuration path on failure.
 */
function collectConfigSecretRefs(
	config: Config,
): readonly { path: string; ref: SecretRef; required: boolean }[] {
	const out: { path: string; ref: SecretRef; required: boolean }[] = [];

	if (config.controlPlane.driver === "astra") {
		out.push({
			path: "controlPlane.tokenRef",
			ref: config.controlPlane.tokenRef,
			required: true,
		});
	}

	const oidcClient = config.auth.oidc?.client;
	if (oidcClient) {
		if (oidcClient.clientSecretRef) {
			out.push({
				path: "auth.oidc.client.clientSecretRef",
				ref: oidcClient.clientSecretRef,
				required: true,
			});
		}
		if (oidcClient.sessionSecretRef) {
			out.push({
				path: "auth.oidc.client.sessionSecretRef",
				ref: oidcClient.sessionSecretRef,
				required: true,
			});
		}
	}

	if (config.chat?.tokenRef) {
		out.push({
			path: "chat.tokenRef",
			ref: config.chat.tokenRef,
			required: true,
		});
	}

	for (let i = 0; i < config.seedWorkspaces.length; i++) {
		const ws = config.seedWorkspaces[i];
		if (!ws) continue;
		const credEntries = ws.credentials ? Object.entries(ws.credentials) : [];
		for (const [k, ref] of credEntries) {
			out.push({
				path: `seedWorkspaces[${i}].credentials.${k}`,
				ref,
				required: false,
			});
		}
		if (
			typeof ws.url === "string" &&
			/^[a-z]+:/.test(ws.url) &&
			!ws.url.startsWith("http")
		) {
			// `url` accepts either a literal URL or a SecretRef; only
			// probe it when it parses as a SecretRef (provider:path) and
			// not as an http(s) URL.
			out.push({
				path: `seedWorkspaces[${i}].url`,
				ref: ws.url as SecretRef,
				required: false,
			});
		}
	}

	return out;
}

/**
 * Probe every config-declared secret reference. Returns the list of
 * misses; the caller decides whether to throw or log.
 */
export async function probeConfigSecrets(
	config: Config,
	resolver: SecretResolver,
): Promise<readonly MissingSecret[]> {
	const refs = collectConfigSecretRefs(config);
	const misses: MissingSecret[] = [];
	await Promise.all(
		refs.map(async ({ path, ref, required }) => {
			try {
				const value = await resolver.resolve(ref);
				if (!value || value.length === 0) {
					misses.push({
						path,
						ref,
						reason: required
							? "secret resolved to an empty string"
							: "secret resolved to an empty string (advisory)",
					});
				}
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				misses.push({
					path,
					ref,
					reason: required ? message : `${message} (advisory)`,
				});
			}
		}),
	);
	return misses;
}

/**
 * Run the preflight check and fail loudly on any required misses. Seed
 * misses are logged as warnings.
 */
export async function assertConfigSecretsResolvable(
	config: Config,
	resolver: SecretResolver,
	opts: PreflightOptions = {},
): Promise<void> {
	const misses = await probeConfigSecrets(config, resolver);
	if (misses.length === 0) {
		opts.logger?.info?.(
			{ checked: true },
			"all configured secret refs resolved",
		);
		return;
	}
	const advisory = misses.filter((m) => m.reason.endsWith("(advisory)"));
	const fatal = misses.filter((m) => !m.reason.endsWith("(advisory)"));
	for (const miss of advisory) {
		opts.logger?.warn?.(
			{ path: miss.path, ref: miss.ref, reason: miss.reason },
			"secret ref unresolved; continuing",
		);
	}
	if (fatal.length > 0) {
		const summary = fatal
			.map((m) => `${m.path} (${m.ref}): ${m.reason}`)
			.join("; ");
		throw new Error(
			`startup secret check failed for ${fatal.length} ref(s): ${summary}`,
		);
	}
}
