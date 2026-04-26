/**
 * Build an {@link AuthResolver} from the parsed config.
 *
 * Phase 3: all four modes are live.
 *   - `disabled` — no verifier
 *   - `apiKey`   — workbench-issued `wb_live_*` keys
 *   - `oidc`     — JWT bearer tokens verified against the configured
 *                  issuer's JWKS
 *   - `any`      — apiKey + oidc both registered; apiKey matches its
 *                  wire shape first (O(1) DB lookup), JWTs fall
 *                  through to oidc
 *
 * `apiKey` needs the {@link ControlPlaneStore}; `oidc` does a JWKS
 * discovery fetch at startup (hence the `async` return). The rest of
 * the hot path is synchronous.
 */

import type { AuthConfig, OidcConfig } from "../config/schema.js";
import type { ControlPlaneStore } from "../control-plane/store.js";
import type { SecretResolver } from "../secrets/provider.js";
import { ApiKeyVerifier } from "./apiKey/verifier.js";
import { BootstrapTokenVerifier } from "./bootstrap.js";
import { makeJwkSet, resolveJwksUri } from "./oidc/jwks.js";
import { OidcVerifier } from "./oidc/verifier.js";
import { AuthResolver, type TokenVerifier } from "./resolver.js";

export interface AuthResolverDeps {
	readonly store: ControlPlaneStore;
	readonly secrets: SecretResolver;
}

export async function buildAuthResolver(
	config: AuthConfig,
	deps: AuthResolverDeps,
): Promise<AuthResolver> {
	const verifiers: TokenVerifier[] = [];

	if (config.bootstrapTokenRef) {
		const token = await deps.secrets.resolve(config.bootstrapTokenRef);
		if (token.length < 32) {
			throw new Error(
				"auth.bootstrapTokenRef must resolve to at least 32 characters",
			);
		}
		verifiers.push(new BootstrapTokenVerifier({ token }));
	}

	if (config.mode === "apiKey" || config.mode === "any") {
		verifiers.push(new ApiKeyVerifier({ store: deps.store }));
	}
	if (config.mode === "oidc" || config.mode === "any") {
		if (!config.oidc) {
			throw new Error(
				`auth.mode='${config.mode}' requires auth.oidc in workbench.yaml`,
			);
		}
		verifiers.push(await buildOidcVerifier(config.oidc));
	}

	return new AuthResolver({
		mode: config.mode,
		anonymousPolicy: config.anonymousPolicy,
		verifiers,
	});
}

async function buildOidcVerifier(config: OidcConfig): Promise<OidcVerifier> {
	const jwksUri = await resolveJwksUri({
		issuer: config.issuer,
		configuredUri: config.jwksUri,
	});
	const getKey = makeJwkSet(jwksUri);
	return new OidcVerifier({ config, getKey });
}
