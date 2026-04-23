/**
 * {@link TokenVerifier} for workbench-issued API keys.
 *
 * Contract (from {@link ../resolver.TokenVerifier}):
 *   - Returns `null` when the token doesn't match the wire shape —
 *     lets a later verifier (e.g. OIDC) claim it.
 *   - Returns an `AuthSubject` when the token resolves to a live,
 *     non-revoked, non-expired key.
 *   - Throws `UnauthorizedError` when the token *does* match the
 *     wire shape but is revoked / expired / doesn't verify against
 *     the stored hash. That surfaces the specific failure reason
 *     to the client instead of a generic "did not match any
 *     scheme" 401.
 *
 * Fire-and-forget bumps `lastUsedAt` on success so operators can
 * see which keys are actually in use.
 */

import type { ControlPlaneStore } from "../../control-plane/store.js";
import { UnauthorizedError } from "../errors.js";
import type { TokenVerifier } from "../resolver.js";
import type { AuthSubject } from "../types.js";
import { parseToken, verifyToken } from "./token.js";

export interface ApiKeyVerifierOptions {
	readonly store: ControlPlaneStore;
	/** Clock for expiry checks — injected in tests. */
	readonly now?: () => Date;
}

export class ApiKeyVerifier implements TokenVerifier {
	readonly scheme = "apiKey" as const;
	private readonly store: ControlPlaneStore;
	private readonly now: () => Date;

	constructor(opts: ApiKeyVerifierOptions) {
		this.store = opts.store;
		this.now = opts.now ?? (() => new Date());
	}

	async verify(token: string): Promise<AuthSubject | null> {
		const parsed = parseToken(token);
		if (!parsed) return null; // not our shape — let other verifiers try

		const record = await this.store.findApiKeyByPrefix(parsed.prefix);
		if (!record) {
			throw new UnauthorizedError("api key not recognized");
		}
		if (record.revokedAt !== null) {
			throw new UnauthorizedError("api key has been revoked");
		}
		if (
			record.expiresAt !== null &&
			record.expiresAt <= this.now().toISOString()
		) {
			throw new UnauthorizedError("api key has expired");
		}
		const ok = await verifyToken(token, record.hash);
		if (!ok) {
			// Prefix matched but digest didn't. Two possibilities:
			// collision (astronomically unlikely) or tampered token.
			// Either way, reject.
			throw new UnauthorizedError("api key digest did not match");
		}

		// Best-effort bump — swallow errors so a backend hiccup on the
		// update doesn't turn a successful auth into a 500.
		this.store.touchApiKey(record.workspace, record.keyId).catch(() => {});

		return {
			type: "apiKey",
			id: record.keyId,
			label: record.label,
			workspaceScopes: [record.workspace],
		};
	}
}
