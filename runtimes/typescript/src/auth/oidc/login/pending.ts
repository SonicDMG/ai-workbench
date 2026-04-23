/**
 * Transient store for the PKCE verifier + state that live between a
 * user clicking \"log in\" and the IdP redirecting them back.
 *
 * Values are keyed by the opaque `state` parameter (random, unique
 * per login attempt) and evict themselves after `ttlMs`. The default
 * 10-minute TTL matches typical IdP authorization-code lifetimes.
 *
 * Single-replica only. Clustered deployments want an external store
 * (Redis / Astra table) — the `PendingLoginStore` interface below is
 * the seam for that.
 */

export interface PendingLogin {
	readonly verifier: string;
	readonly nonce: string;
	readonly redirectAfter: string;
	readonly createdAt: number;
}

export interface PendingLoginStore {
	put(state: string, value: PendingLogin): void;
	take(state: string): PendingLogin | null;
}

export interface MemoryPendingLoginStoreOptions {
	readonly ttlMs?: number;
	readonly now?: () => number;
	readonly maxEntries?: number;
}

/** In-memory PendingLoginStore with TTL + bounded size. */
export class MemoryPendingLoginStore implements PendingLoginStore {
	private readonly ttlMs: number;
	private readonly now: () => number;
	private readonly maxEntries: number;
	private readonly entries = new Map<string, PendingLogin>();

	constructor(opts: MemoryPendingLoginStoreOptions = {}) {
		this.ttlMs = opts.ttlMs ?? 10 * 60 * 1000;
		this.now = opts.now ?? Date.now;
		this.maxEntries = opts.maxEntries ?? 1024;
	}

	put(state: string, value: PendingLogin): void {
		this.evictExpired();
		if (this.entries.size >= this.maxEntries) {
			// Fall back to FIFO eviction on overflow — keeps a runaway IdP
			// bot from unbounded-growing the map even if no TTL has fired.
			const oldest = this.entries.keys().next().value;
			if (oldest !== undefined) this.entries.delete(oldest);
		}
		this.entries.set(state, value);
	}

	take(state: string): PendingLogin | null {
		const v = this.entries.get(state);
		if (!v) return null;
		this.entries.delete(state);
		if (this.now() - v.createdAt > this.ttlMs) return null;
		return v;
	}

	private evictExpired(): void {
		const cutoff = this.now() - this.ttlMs;
		for (const [k, v] of this.entries) {
			if (v.createdAt <= cutoff) this.entries.delete(k);
		}
	}
}
