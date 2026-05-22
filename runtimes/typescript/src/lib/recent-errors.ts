/**
 * Bounded in-memory log of the most recent API errors. Surfaced to
 * operators via `GET /health/recent-errors` and the web `/status`
 * page so a stuck install is visible without grepping container logs.
 *
 * Strict no-PII policy: we record the `code` (registry string), the
 * HTTP `status`, the matched route pattern (NOT the literal path —
 * IDs and query strings are dropped by `routeLabel`), the assigned
 * `requestId`, and the wall-clock timestamp. Nothing else.
 *
 * Backed by a fixed-size circular buffer (default 100 slots). New
 * entries overwrite the oldest. Read operations return a snapshot in
 * newest-first order.
 */

export interface RecentErrorEntry {
	readonly ts: string;
	readonly code: string;
	readonly status: number;
	readonly method: string;
	readonly routePattern: string;
	readonly requestId: string;
}

export interface RecentErrorBuffer {
	record(entry: Omit<RecentErrorEntry, "ts">): void;
	snapshot(): readonly RecentErrorEntry[];
	clear(): void;
	readonly capacity: number;
}

export function createRecentErrorBuffer(capacity = 100): RecentErrorBuffer {
	if (!Number.isInteger(capacity) || capacity <= 0) {
		throw new Error(`capacity must be a positive integer, got ${capacity}`);
	}
	const slots: (RecentErrorEntry | null)[] = new Array(capacity).fill(null);
	let next = 0;
	let count = 0;

	return {
		capacity,
		record(entry) {
			slots[next] = { ...entry, ts: new Date().toISOString() };
			next = (next + 1) % capacity;
			if (count < capacity) count += 1;
		},
		snapshot() {
			if (count === 0) return [];
			const out: RecentErrorEntry[] = [];
			// Walk backwards from `next - 1` so newest comes first.
			for (let i = 0; i < count; i += 1) {
				const idx = (next - 1 - i + capacity) % capacity;
				const entry = slots[idx];
				if (entry) out.push(entry);
			}
			return out;
		},
		clear() {
			for (let i = 0; i < slots.length; i += 1) slots[i] = null;
			next = 0;
			count = 0;
		},
	};
}
