/**
 * {@link TokenVerifier} for OIDC-issued JWTs.
 *
 * Contract matches `../resolver.TokenVerifier`:
 *   - Returns `null` when the token doesn't look like a JWT at all —
 *     lets the next verifier (e.g. API-key) try.
 *   - Returns an `AuthSubject` when the token verifies against the
 *     issuer's JWKS and passes `iss` / `aud` / `exp` / `nbf` checks.
 *   - Throws {@link UnauthorizedError} for every token that IS a JWT
 *     but fails validation — bad signature, wrong audience, expired,
 *     missing required claim, etc. — so the caller sees a specific
 *     reason instead of a generic "no scheme matched" 401.
 *
 * We DON'T look up the subject in the control plane or in any user
 * table. The IdP is the source of truth; workspace access comes from
 * the `workspaceScopes` claim. Operators who want per-workspace
 * access control assign that claim (via IdP admin console or a
 * scope-mapper) when provisioning users.
 */

import { type JWTPayload, type JWTVerifyGetKey, jwtVerify } from "jose";
import type { OidcConfig } from "../../config/schema.js";
import { UnauthorizedError } from "../errors.js";
import type { TokenVerifier } from "../resolver.js";
import type { AuthSubject } from "../types.js";
import { subjectFromClaims } from "./claims.js";

export interface OidcVerifierOptions {
	readonly config: OidcConfig;
	readonly getKey: JWTVerifyGetKey;
}

// Three non-empty dot-separated base64url segments. Strict enough to
// weed out `wb_live_*` and other non-JWT formats so we fall through
// to the apiKey verifier in `any` mode; loose enough to cover all
// real JWTs (signature alg is checked by jose later).
const JWT_SHAPE_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export class OidcVerifier implements TokenVerifier {
	readonly scheme = "oidc" as const;
	private readonly config: OidcConfig;
	private readonly getKey: JWTVerifyGetKey;
	private readonly audience: string[];

	constructor(opts: OidcVerifierOptions) {
		this.config = opts.config;
		this.getKey = opts.getKey;
		this.audience = Array.isArray(opts.config.audience)
			? [...opts.config.audience]
			: [opts.config.audience];
	}

	async verify(token: string): Promise<AuthSubject | null> {
		if (!JWT_SHAPE_RE.test(token)) return null;

		let payload: JWTPayload;
		try {
			const result = await jwtVerify(token, this.getKey, {
				issuer: this.config.issuer,
				audience: this.audience,
				clockTolerance: this.config.clockToleranceSeconds,
			});
			payload = result.payload;
		} catch (err) {
			throw new UnauthorizedError(formatJoseError(err));
		}

		try {
			return subjectFromClaims(payload, this.config);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "claim mapping failed";
			throw new UnauthorizedError(msg);
		}
	}
}

/**
 * Translate a jose validation error into a short, safe message. We
 * never pass the raw error out — some jose messages include the token
 * or key material, which operators don't want in client responses.
 */
function formatJoseError(err: unknown): string {
	const code =
		typeof err === "object" && err !== null && "code" in err
			? String((err as { code: unknown }).code)
			: null;
	switch (code) {
		case "ERR_JWT_EXPIRED":
			return "oidc token has expired";
		case "ERR_JWT_CLAIM_VALIDATION_FAILED":
			return "oidc token failed claim validation";
		case "ERR_JWS_SIGNATURE_VERIFICATION_FAILED":
			return "oidc token signature did not verify";
		case "ERR_JWKS_NO_MATCHING_KEY":
			return "oidc token 'kid' does not match any key in the JWKS";
		case "ERR_JWS_INVALID":
		case "ERR_JWT_INVALID":
			return "oidc token is malformed";
		default:
			return "oidc token verification failed";
	}
}
