/**
 * The {@link AuthResolver} is what the middleware calls on every
 * request. It:
 *   - parses the `Authorization` header,
 *   - walks a list of registered {@link TokenVerifier}s until one
 *     claims the token,
 *   - and applies the configured {@link AnonymousPolicy} when no
 *     token is presented.
 *
 * Phase 1 (this PR) ships with an empty verifier list, so every
 * token is rejected and every tokenless request falls through to
 * the anonymous path. The resolver is mode-agnostic on purpose —
 * adding API-key or OIDC auth in later PRs just means registering
 * another verifier.
 */

import { UnauthorizedError } from "./errors.js";
import type {
	AnonymousPolicy,
	AuthContext,
	AuthMode,
	AuthSubject,
} from "./types.js";

export interface TokenVerifier {
	readonly scheme: AuthSubject["type"];
	/**
	 * Try to verify a bearer token.
	 *   - Returns an {@link AuthSubject} when the verifier recognizes
	 *     AND accepts the token.
	 *   - Returns `null` when the verifier doesn't recognize the shape
	 *     (e.g. a JWT verifier seeing an API-key prefix) — the
	 *     resolver will try the next verifier.
	 *   - Throws {@link UnauthorizedError} when the verifier recognizes
	 *     the token but it's invalid / expired / revoked.
	 */
	verify(token: string): Promise<AuthSubject | null>;
}

export interface AuthResolverOptions {
	readonly mode: AuthMode;
	readonly anonymousPolicy: AnonymousPolicy;
	readonly verifiers: readonly TokenVerifier[];
}

export class AuthResolver {
	constructor(private readonly opts: AuthResolverOptions) {}

	async authenticate(req: Request): Promise<AuthContext> {
		const header = req.headers.get("authorization");
		if (!header) {
			if (this.opts.anonymousPolicy === "reject") {
				throw new UnauthorizedError("Authorization header is required");
			}
			return this.anonymous();
		}

		const token = parseBearer(header);
		if (!token) {
			throw new UnauthorizedError("expected 'Authorization: Bearer <token>'");
		}

		for (const v of this.opts.verifiers) {
			const subject = await v.verify(token);
			if (subject) {
				return {
					mode: this.opts.mode,
					authenticated: true,
					anonymous: false,
					subject,
				};
			}
		}

		throw new UnauthorizedError(
			"token did not match any configured auth scheme",
		);
	}

	private anonymous(): AuthContext {
		return {
			mode: this.opts.mode,
			authenticated: false,
			anonymous: true,
			subject: null,
		};
	}
}

function parseBearer(header: string): string | null {
	const [scheme, value] = header.split(/\s+/, 2);
	if (!scheme || scheme.toLowerCase() !== "bearer" || !value) return null;
	return value.trim();
}
