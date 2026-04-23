/**
 * Build an {@link AuthResolver} from the parsed config.
 *
 * Phase 2: `mode: "disabled"` (PR #1) and `mode: "apiKey"` (this PR)
 * are both accepted. `oidc` / `any` still fail loudly at startup.
 *
 * `apiKey` needs the {@link ControlPlaneStore} so the verifier can
 * look up keys by prefix; `disabled` doesn't.
 */

import type { AuthConfig } from "../config/schema.js";
import type { ControlPlaneStore } from "../control-plane/store.js";
import { ApiKeyVerifier } from "./apiKey/verifier.js";
import { AuthResolver } from "./resolver.js";

export interface AuthResolverDeps {
	readonly store: ControlPlaneStore;
}

export function buildAuthResolver(
	config: AuthConfig,
	deps: AuthResolverDeps,
): AuthResolver {
	switch (config.mode) {
		case "disabled":
			return new AuthResolver({
				mode: "disabled",
				anonymousPolicy: config.anonymousPolicy,
				verifiers: [],
			});
		case "apiKey":
			return new AuthResolver({
				mode: "apiKey",
				anonymousPolicy: config.anonymousPolicy,
				verifiers: [new ApiKeyVerifier({ store: deps.store })],
			});
		case "oidc":
			throw new Error(
				"auth.mode='oidc' is not yet implemented in this runtime — ships in a later PR",
			);
		case "any":
			throw new Error(
				"auth.mode='any' is not yet implemented in this runtime — ships in a later PR (combines apiKey + oidc)",
			);
	}
}
