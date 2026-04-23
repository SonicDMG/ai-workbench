/**
 * PKCE helpers — RFC 7636.
 *
 * The verifier is a random string 43-128 chars of the unreserved
 * alphabet; the challenge is its base64url-unpadded SHA-256 digest.
 */

import { createHash, randomBytes } from "node:crypto";

/** Return a 43-char (32-byte) URL-safe verifier. */
export function generateVerifier(): string {
	return toBase64Url(randomBytes(32));
}

export function challengeFor(verifier: string): string {
	return toBase64Url(createHash("sha256").update(verifier).digest());
}

/** Short URL-safe random token — used for OAuth `state` / `nonce`. */
export function generateState(): string {
	return toBase64Url(randomBytes(16));
}

export function toBase64Url(buf: Buffer): string {
	return buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}
