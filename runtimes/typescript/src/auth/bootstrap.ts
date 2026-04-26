import { createHash, timingSafeEqual } from "node:crypto";
import type { TokenVerifier } from "./resolver.js";
import type { AuthSubject } from "./types.js";

export interface BootstrapTokenVerifierOptions {
	readonly token: string;
}

/**
 * Optional break-glass operator token. It is configured by SecretRef,
 * never persisted by the runtime, and maps to an unscoped subject so
 * operators can create the first workspace/API key while strict auth is
 * already enabled.
 */
export class BootstrapTokenVerifier implements TokenVerifier {
	readonly scheme = "bootstrap" as const;
	private readonly digest: Buffer;

	constructor(opts: BootstrapTokenVerifierOptions) {
		this.digest = sha256(opts.token);
	}

	async verify(token: string): Promise<AuthSubject | null> {
		if (!timingSafeEqual(sha256(token), this.digest)) return null;
		return {
			type: "bootstrap",
			id: "bootstrap",
			label: "Bootstrap operator token",
			workspaceScopes: null,
		};
	}
}

function sha256(value: string): Buffer {
	return createHash("sha256").update(value, "utf8").digest();
}
