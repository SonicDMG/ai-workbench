/**
 * Signed session cookie.
 *
 * The cookie value is `<payload>.<hmac>` where both halves are
 * base64url. `payload` is UTF-8 JSON; `hmac` is HMAC-SHA256 of the
 * payload. Signing prevents a client from fabricating a cookie; the
 * cookie is sent `HttpOnly; SameSite=Lax` so JS can't read it and
 * top-level navigations still carry it through the OAuth redirect.
 *
 * The session payload carries the access token (a JWT). The existing
 * `OidcVerifier` then validates iss/aud/exp/nbf + signature exactly
 * as it would for a bearer-auth API request — same trust boundary,
 * zero extra state on the server. When the JWT expires, the UI gets
 * a 401 and triggers a re-login.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

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

export function makeCookieSigner(keyBytes: Buffer): CookieSigner {
	return {
		sign(payload) {
			const body = Buffer.from(JSON.stringify(payload), "utf8");
			const mac = createHmac("sha256", keyBytes).update(body).digest();
			return `${toBase64Url(body)}.${toBase64Url(mac)}`;
		},
		verify(value) {
			const dot = value.indexOf(".");
			if (dot < 0) return null;
			const bodyB64 = value.slice(0, dot);
			const macB64 = value.slice(dot + 1);
			let body: Buffer;
			let mac: Buffer;
			try {
				body = fromBase64Url(bodyB64);
				mac = fromBase64Url(macB64);
			} catch {
				return null;
			}
			const expected = createHmac("sha256", keyBytes).update(body).digest();
			if (mac.length !== expected.length) return null;
			if (!timingSafeEqual(mac, expected)) return null;
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
		return decodeURIComponent(part.slice(eq + 1).trim());
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
