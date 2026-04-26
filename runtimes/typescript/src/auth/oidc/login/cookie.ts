/**
 * Encrypted session cookie.
 *
 * The cookie value is `v2.<iv>.<ciphertext>.<tag>`, all base64url
 * except the version marker. The payload is UTF-8 JSON encrypted with
 * AES-256-GCM. GCM gives confidentiality and integrity: clients cannot
 * read the IdP tokens inside, cannot forge a cookie, and cannot tamper
 * with the payload without verification failing. The cookie is sent
 * `HttpOnly; SameSite=Lax` so JS can't read it and top-level
 * navigations still carry it through the OAuth redirect.
 *
 * The session payload carries the access token (a JWT). The existing
 * `OidcVerifier` then validates iss/aud/exp/nbf + signature exactly
 * as it would for a bearer-auth API request — same trust boundary,
 * zero extra state on the server. When the JWT expires, the UI gets
 * a 401 and triggers a re-login.
 */

import {
	createCipheriv,
	createDecipheriv,
	createHash,
	randomBytes,
} from "node:crypto";

export interface SessionPayload {
	readonly accessToken: string;
	readonly issuedAt: number;
	readonly refreshToken?: string;
	readonly idToken?: string;
}

export interface CookieSigner {
	sign(payload: SessionPayload): string;
	verify(value: string): SessionPayload | null;
}

const COOKIE_VERSION = "v2";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_INFO = "ai-workbench oidc session cookie v2";

export function makeCookieSigner(keyBytes: Buffer): CookieSigner {
	const key = deriveAesKey(keyBytes);
	return {
		sign(payload) {
			const iv = randomBytes(IV_LEN);
			const cipher = createCipheriv("aes-256-gcm", key, iv, {
				authTagLength: TAG_LEN,
			});
			cipher.setAAD(Buffer.from(COOKIE_VERSION, "utf8"));
			const body = Buffer.from(JSON.stringify(payload), "utf8");
			const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
			const tag = cipher.getAuthTag();
			return [
				COOKIE_VERSION,
				toBase64Url(iv),
				toBase64Url(ciphertext),
				toBase64Url(tag),
			].join(".");
		},
		verify(value) {
			const parts = value.split(".");
			if (parts.length !== 4 || parts[0] !== COOKIE_VERSION) return null;
			let iv: Buffer;
			let ciphertext: Buffer;
			let tag: Buffer;
			try {
				iv = fromBase64Url(parts[1] as string);
				ciphertext = fromBase64Url(parts[2] as string);
				tag = fromBase64Url(parts[3] as string);
			} catch {
				return null;
			}
			if (iv.length !== IV_LEN || tag.length !== TAG_LEN) return null;
			let body: Buffer;
			try {
				const decipher = createDecipheriv("aes-256-gcm", key, iv, {
					authTagLength: TAG_LEN,
				});
				decipher.setAAD(Buffer.from(COOKIE_VERSION, "utf8"));
				decipher.setAuthTag(tag);
				body = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
			} catch {
				return null;
			}
			try {
				const obj = JSON.parse(body.toString("utf8"));
				if (
					!obj ||
					typeof obj !== "object" ||
					typeof obj.accessToken !== "string" ||
					typeof obj.issuedAt !== "number"
				) {
					return null;
				}
				return obj as SessionPayload;
			} catch {
				return null;
			}
		},
	};
}

function deriveAesKey(keyBytes: Buffer): Buffer {
	return createHash("sha256").update(KEY_INFO).update(keyBytes).digest();
}

export function generateSessionKey(): Buffer {
	return randomBytes(32);
}

export interface CookieSerializeOptions {
	readonly name: string;
	readonly value: string;
	readonly maxAgeSeconds?: number;
	readonly path?: string;
	readonly secure?: boolean;
	readonly httpOnly?: boolean;
	readonly sameSite?: "Strict" | "Lax" | "None";
}

export function serializeCookie(opts: CookieSerializeOptions): string {
	const parts = [`${opts.name}=${opts.value}`];
	parts.push(`Path=${opts.path ?? "/"}`);
	if (opts.httpOnly !== false) parts.push("HttpOnly");
	if (opts.secure) parts.push("Secure");
	parts.push(`SameSite=${opts.sameSite ?? "Lax"}`);
	if (typeof opts.maxAgeSeconds === "number") {
		parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`);
	}
	return parts.join("; ");
}

/**
 * Parse the value of a single named cookie out of a Cookie header.
 * Returns null when the cookie isn't present or the header is blank.
 */
export function parseCookie(
	header: string | null,
	name: string,
): string | null {
	if (!header) return null;
	const parts = header.split(";");
	for (const part of parts) {
		const eq = part.indexOf("=");
		if (eq < 0) continue;
		const k = part.slice(0, eq).trim();
		if (k !== name) continue;
		try {
			return decodeURIComponent(part.slice(eq + 1).trim());
		} catch {
			return null;
		}
	}
	return null;
}

function toBase64Url(buf: Buffer): string {
	return buf
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function fromBase64Url(input: string): Buffer {
	const pad = 4 - (input.length % 4);
	const normalized =
		input.replace(/-/g, "+").replace(/_/g, "/") +
		(pad < 4 ? "=".repeat(pad) : "");
	return Buffer.from(normalized, "base64");
}
