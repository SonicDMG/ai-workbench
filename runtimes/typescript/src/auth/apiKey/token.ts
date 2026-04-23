/**
 * Token parsing + minting for workbench-issued API keys.
 *
 * Wire format: `wb_live_<prefix>_<secret>`
 *   - `prefix` — 12 chars, Crockford-ish base36 [a-z0-9]. Globally
 *     unique. Used as the lookup index on every request so verify
 *     is O(1). NOT a secret.
 *   - `secret` — 32 chars base36. The actual secret. Never stored;
 *     only the scrypt digest of the full token lives at rest.
 *
 * Design notes:
 *   - Key-prefix convention mirrors Stripe (`sk_live_*`) and GitHub
 *     (`ghp_*`). That makes leaked keys greppable and unlocks public
 *     secret-scanning.
 *   - `live` is the only environment tag today. `test` is reserved
 *     for a future tier that wouldn't gate production traffic.
 *   - The full token (not just the secret) is hashed. That way two
 *     tokens with the same secret but different prefixes hash
 *     differently, and you can't pre-compute rainbow tables across
 *     a shared secret space.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify<Buffer, Buffer, number, Buffer>(scryptCb);

const PREFIX_LEN = 12;
const SECRET_LEN = 32;
const SCRYPT_SALT_LEN = 16;
const SCRYPT_KEY_LEN = 32;
const TOKEN_RE = /^wb_live_([a-z0-9]{12})_([a-z0-9]{32})$/;

export interface MintedToken {
	readonly plaintext: string;
	readonly prefix: string;
	readonly hash: string;
}

export interface ParsedToken {
	readonly prefix: string;
	readonly secret: string;
}

export function parseToken(token: string): ParsedToken | null {
	const m = TOKEN_RE.exec(token);
	if (!m) return null;
	return { prefix: m[1] as string, secret: m[2] as string };
}

/**
 * Generate a fresh token + its salted scrypt digest. The plaintext
 * is returned ONCE; the caller is responsible for showing it to the
 * user and then discarding it. Only the prefix + hash get persisted.
 */
export async function mintToken(): Promise<MintedToken> {
	const prefix = randomBase36(PREFIX_LEN);
	const secret = randomBase36(SECRET_LEN);
	const plaintext = `wb_live_${prefix}_${secret}`;
	const hash = await hashToken(plaintext);
	return { plaintext, prefix, hash };
}

/**
 * scrypt(plaintext, salt) → `scrypt$<salt-hex>$<hash-hex>`.
 * Storing salt inline keeps verification self-contained — no
 * separate column.
 */
export async function hashToken(plaintext: string): Promise<string> {
	const salt = randomBytes(SCRYPT_SALT_LEN);
	const derived = await scrypt(
		Buffer.from(plaintext, "utf8"),
		salt,
		SCRYPT_KEY_LEN,
	);
	return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Constant-time compare a candidate plaintext against the stored
 * digest. Returns `false` on any malformed input so a caller can
 * treat the result as authoritative without extra try/catch.
 */
export async function verifyToken(
	plaintext: string,
	stored: string,
): Promise<boolean> {
	const parts = stored.split("$");
	if (parts.length !== 3 || parts[0] !== "scrypt") return false;
	let salt: Buffer;
	let expected: Buffer;
	try {
		salt = Buffer.from(parts[1] as string, "hex");
		expected = Buffer.from(parts[2] as string, "hex");
	} catch {
		return false;
	}
	if (expected.length !== SCRYPT_KEY_LEN) return false;
	const derived = await scrypt(
		Buffer.from(plaintext, "utf8"),
		salt,
		SCRYPT_KEY_LEN,
	);
	if (derived.length !== expected.length) return false;
	return timingSafeEqual(derived, expected);
}

function randomBase36(len: number): string {
	// 8 random bytes / base36 char ≈ 1 byte. We pull extra and trim
	// to dodge modulo bias.
	const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
	const out: string[] = [];
	const buf = randomBytes(len * 2);
	for (let i = 0; out.length < len && i < buf.length; i++) {
		const b = buf[i] as number;
		if (b < alphabet.length * 7) {
			out.push(alphabet[b % alphabet.length] as string);
		}
	}
	if (out.length < len) {
		// Extremely unlikely, but fall back to re-draw.
		return randomBase36(len);
	}
	return out.join("");
}
