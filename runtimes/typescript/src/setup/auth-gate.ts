/**
 * Shared auth gate for the setup mutation routes (`POST /setup/env`,
 * `POST /setup/restart`).
 *
 * Two code paths mount these routes and MUST enforce identical auth:
 *   - the healthy-boot wizard ({@link file://./../routes/setup.ts}), and
 *   - the rescue-mode app ({@link file://./../rescue/app.ts}) that comes
 *     up when control-plane init throws.
 *
 * Both import {@link setupAuthGate} so the posture can't diverge: a
 * control-plane boot failure must NOT silently drop the bootstrap-token
 * requirement and leave an unauthenticated network caller able to
 * overwrite managed credentials and restart into attacker config.
 *
 * `GET /setup-status` stays intentionally open on both paths so the SPA
 * can render its first frame; only the mutating routes are gated.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { AuthConfig } from "../config/schema.js";
import { errorEnvelope } from "../lib/errors.js";
import type { AppEnv } from "../lib/types.js";
import type { SecretResolver } from "../secrets/provider.js";

/**
 * The slice of setup deps the gate needs. Both the healthy
 * (`SetupRouteDeps`) and rescue (`RescueAppDeps`) dependency bags are
 * structurally compatible with this shape.
 */
export interface SetupAuthDeps {
	readonly auth: AuthConfig;
	readonly secrets: SecretResolver;
}

const UNAUTHORIZED_MESSAGE =
	"Setup endpoints require the bootstrap token when auth is enabled.";

function sha256(value: string): Buffer {
	return createHash("sha256").update(value, "utf8").digest();
}

/**
 * Constant-time, length-safe compare of a presented bearer against the
 * expected bootstrap token. Both sides are hashed to a fixed-width
 * SHA-256 digest first, so {@link timingSafeEqual} never sees
 * mismatched lengths (which would throw) and the comparison leaks
 * neither length nor content via timing. Mirrors the pattern in
 * `auth/bootstrap.ts`.
 */
function tokensMatch(presented: string, expected: string): boolean {
	return timingSafeEqual(sha256(presented), sha256(expected));
}

/**
 * Resolve the bootstrap token (if configured) so the setup gate can
 * compare. Resolved once per request — keep this in a small cache if
 * profiling shows it's hot, but the wizard / settings surface is
 * low-frequency.
 */
export async function resolveBootstrapToken(
	deps: SetupAuthDeps,
): Promise<string | null> {
	if (!deps.auth.bootstrapTokenRef) return null;
	try {
		const token = await deps.secrets.resolve(deps.auth.bootstrapTokenRef);
		return token.length > 0 ? token : null;
	} catch {
		return null;
	}
}

/**
 * Inline auth gate for the mutation routes (`/setup/env`,
 * `/setup/restart`):
 *   - Always allow if a valid bootstrap token is presented.
 *   - Otherwise allow whenever `auth.mode === "disabled"` (the
 *     single-user dev posture — no privilege boundary exists, so
 *     `/settings` in the SPA can edit credentials post-setup too,
 *     not just during the first-run wizard window).
 *   - Reject everything else with 401.
 *
 * `/setup-status` is intentionally unauthenticated so the wizard
 * and the settings page can render their first frame.
 */
export function setupAuthGate(deps: SetupAuthDeps): MiddlewareHandler<AppEnv> {
	return async (c, next) => {
		const auth = c.req.header("authorization");
		const bearer = auth?.toLowerCase().startsWith("bearer ")
			? auth.slice(7).trim()
			: null;
		if (bearer) {
			const expected = await resolveBootstrapToken(deps);
			if (expected && tokensMatch(bearer, expected)) {
				return next();
			}
			return c.json(
				errorEnvelope(c, "unauthorized", UNAUTHORIZED_MESSAGE),
				401,
			);
		}
		if (deps.auth.mode === "disabled") {
			return next();
		}
		return c.json(errorEnvelope(c, "unauthorized", UNAUTHORIZED_MESSAGE), 401);
	};
}
