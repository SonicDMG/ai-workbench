import { logger } from "../lib/logger.js";

/**
 * Two checks on the auth/control-plane combo at startup:
 *
 *   1. **Open auth on a durable control plane** (`file`/`astra` +
 *      `mode: disabled` or `anonymousPolicy: allow`) — surfaced as a
 *      *loud* multi-line warning by default, since the dev loop
 *      regularly pairs a file CP with the open defaults. Operators
 *      can flip `auth.acknowledgeOpenAccess: false` to convert the
 *      warning into a fatal — useful in CI / shared environments
 *      where any non-strict auth is a configuration bug.
 *
 *   2. **OIDC client without `sessionSecretRef`** on a non-memory CP
 *      — always fatal, no opt-out. An ephemeral session key silently
 *      invalidates every browser session on restart and is broken
 *      across replicas, so there's no scenario where defaulting it
 *      makes sense in production-like deployments.
 *
 * Memory CP is exempt from both checks: state dies with the process,
 * so there's nothing for an unauthenticated caller to harm beyond a
 * single dev session.
 *
 * Production hardening (env=production requires apiKey/oidc/any +
 * anonymousPolicy:reject + non-ephemeral session secret) is enforced
 * separately at schema-validation time in `config/schema.ts` — that
 * path is unconditional and not affected by `acknowledgeOpenAccess`.
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

	const authIsOpen =
		config.auth.mode === "disabled" || config.auth.anonymousPolicy === "allow";

	// Open-auth handling: warn loudly by default, fatal only when the
	// operator has explicitly turned the safety net back on.
	if (authIsOpen) {
		if (!config.auth.acknowledgeOpenAccess) {
			const fatal = `refusing to start: auth.acknowledgeOpenAccess is false and auth.mode='${config.auth.mode}' with anonymousPolicy='${config.auth.anonymousPolicy}' on a '${config.controlPlane.driver}' control plane exposes every API surface unauthenticated. Set auth.mode to apiKey/oidc/any with anonymousPolicy: reject, or flip auth.acknowledgeOpenAccess back to true (the default) to keep this combination as a startup warning.`;
			logger.error(
				{
					controlPlane: config.controlPlane.driver,
					authMode: config.auth.mode,
					anonymousPolicy: config.auth.anonymousPolicy,
				},
				fatal,
			);
			throw new Error(fatal);
		}
		emitOpenAuthBanner({
			driver: config.controlPlane.driver,
			authMode: config.auth.mode,
			anonymousPolicy: config.auth.anonymousPolicy,
		});
	}

	// Session-key handling: unconditional fail. No `acknowledge…`
	// override — a stale ephemeral key bites the same regardless of
	// whether the proxy auths upstream.
	const oidcClient = config.auth.oidc?.client;
	if (oidcClient && !oidcClient.sessionSecretRef) {
		const fatal = `refusing to start: auth.oidc.client.sessionSecretRef is required on a '${config.controlPlane.driver}' control plane. An ephemeral session key invalidates browser logins on every restart and is unsafe across replicas.`;
		logger.error(
			{
				controlPlane: config.controlPlane.driver,
				authMode: config.auth.mode,
			},
			fatal,
		);
		throw new Error(fatal);
	}
}

/**
 * Multi-line attention banner for the open-auth-on-durable-store
 * combination. Pino renders each line individually; we lead with a
 * blank line and a row of `!` so the warning visually breaks out of
 * the surrounding info-level startup chatter.
 */
function emitOpenAuthBanner(ctx: {
	readonly driver: string;
	readonly authMode: string;
	readonly anonymousPolicy: string;
}): void {
	const lines = [
		"",
		"!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
		"!!  OPEN AUTH ON A DURABLE CONTROL PLANE                                  !!",
		`${`!!  controlPlane.driver = '${ctx.driver}'`.padEnd(76, " ")}!!`,
		`${`!!  auth.mode           = '${ctx.authMode}'`.padEnd(76, " ")}!!`,
		`${`!!  anonymousPolicy     = '${ctx.anonymousPolicy}'`.padEnd(76, " ")}!!`,
		"!!                                                                        !!",
		"!!  Every /api/v1/* surface is reachable without authentication. The      !!",
		"!!  runtime ships with this as the default for the dev loop —             !!",
		"!!  acknowledgeOpenAccess defaults to true so the durable-state           !!",
		"!!  quickstart works without a wrapping reverse proxy.                    !!",
		"!!                                                                        !!",
		"!!  BEFORE EXPOSING THIS PORT BEYOND localhost:                           !!",
		"!!    1. Set runtime.environment: production (the schema then forces      !!",
		"!!       apiKey/oidc/any + anonymousPolicy: reject + a session secret).   !!",
		"!!    2. OR, leave dev mode but set auth.acknowledgeOpenAccess: false     !!",
		"!!       to convert this warning into a startup fatal.                    !!",
		"!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!",
		"",
	];
	for (const line of lines) {
		logger.warn(line);
	}
}
