/**
 * Build an {@link AuthResolver} from the parsed config.
 *
 * Phase 1: only `mode: "disabled"` is accepted — other modes fail
 * loudly at startup with a clear message pointing at the PR that
 * will enable them. That keeps the contract honest: a config that
 * asks for `apiKey` on a runtime that doesn't implement it yet
 * should not silently fall through to unauthenticated traffic.
 */

import type { AuthConfig } from "../config/schema.js";
import { AuthResolver } from "./resolver.js";

export function buildAuthResolver(config: AuthConfig): AuthResolver {
	switch (config.mode) {
		case "disabled":
			return new AuthResolver({
				mode: "disabled",
				anonymousPolicy: config.anonymousPolicy,
				verifiers: [],
			});
		case "apiKey":
			throw new Error(
				"auth.mode='apiKey' is not yet implemented in this runtime — ships in a later PR",
			);
		case "oidc":
			throw new Error(
				"auth.mode='oidc' is not yet implemented in this runtime — ships in a later PR",
			);
		case "any":
			throw new Error(
				"auth.mode='any' is not yet implemented in this runtime — ships in a later PR",
			);
	}
}
