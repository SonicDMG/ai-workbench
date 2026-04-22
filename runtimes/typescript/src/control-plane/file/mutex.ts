/**
 * Tiny in-process mutex. Serializes a sequence of async sections so
 * read-modify-write operations on a shared file are safe within a single
 * Node.js process.
 *
 * Not a replacement for a distributed lock — {@link ../file/store} is
 * single-node. For multi-writer setups, use the astra backend.
 */
export class Mutex {
	private tail: Promise<void> = Promise.resolve();

	async run<T>(fn: () => Promise<T>): Promise<T> {
		const previous = this.tail;
		let release!: () => void;
		this.tail = new Promise<void>((resolve) => {
			release = resolve;
		});
		try {
			await previous;
			return await fn();
		} finally {
			release();
		}
	}
}
