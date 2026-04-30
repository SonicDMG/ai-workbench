import { logger } from "../lib/logger.js";

/**
 * Refuse to start when a durable control plane (file/astra) is paired
 * with open auth or an ephemeral OIDC session key. Pure dev runs
 * (memory control plane) are exempt — that's where developers wire
 * things up and we don't want to break the quickstart.
 *
 * Operators with a trusted reverse proxy that does its own auth can
 * opt back in by setting `auth.acknowledgeOpenAccess: true`. The
 * `sessionSecretRef` requirement has no opt-out — an ephemeral key
 * silently invalidates every session on restart and is broken across
 * replicas, so the right answer is always "set the secret."
 */
export function assertSafeAuthDeployment(config: {
	readonly controlPlane: { readonly driver: string };
	readonly auth: {
		readonly mode: string;
		readonly anonymousPolicy: string;
		readonly acknowledgeOpenAccess: boolean;
		readonly bootstrapTokenRef?: string | null;
		readonly oidc?: {
			readonly client?: { readonly sessionSecretRef: string | null };
		};
	};
}): void {
	if (config.controlPlane.driver === "memory") {
		return;
	}

	const errors: string[] = [];
	const authIsOpen =
		config.auth.mode === "disabled" || config.auth.anonymousPolicy === "allow";
	if (authIsOpen && !config.auth.acknowledgeOpenAccess) {
		errors.push(
			`auth.mode='${config.auth.mode}' with anonymousPolicy='${config.auth.anonymousPolicy}' on a '${config.controlPlane.driver}' control plane exposes every API surface unauthenticated. Set auth.mode to apiKey/oidc/any with anonymousPolicy: reject, or set auth.acknowledgeOpenAccess: true to opt in (e.g. behind a trusted auth proxy).`,
		);
	}
	const oidcClient = config.auth.oidc?.client;
	if (oidcClient && !oidcClient.sessionSecretRef) {
		errors.push(
			"auth.oidc.client.sessionSecretRef is required on a non-memory control plane. An ephemeral session key invalidates browser logins on every restart and is unsafe across replicas.",
		);
	}

	if (errors.length === 0) {
		return;
	}
	const message = `refusing to start with unsafe auth on '${config.controlPlane.driver}' control plane:\n  - ${errors.join("\n  - ")}`;
	logger.error(
		{
			controlPlane: config.controlPlane.driver,
			authMode: config.auth.mode,
			anonymousPolicy: config.auth.anonymousPolicy,
		},
		message,
	);
	throw new Error(message);
}
