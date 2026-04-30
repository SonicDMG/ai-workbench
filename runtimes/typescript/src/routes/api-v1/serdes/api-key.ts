/**
 * Wire converter for API-key records.
 *
 * Removes the secret `hash` and remaps the internal `workspace`
 * partition key to the public `workspaceId` naming used everywhere
 * else on the wire. Generic over the row shape so call sites can pass
 * either the persisted record or the create-time variant that carries
 * the freshly-minted plaintext alongside the hash.
 */

function stripHash<T extends { readonly hash: string }>(
	rec: T,
): Omit<T, "hash"> {
	const { hash: _hash, ...rest } = rec;
	return rest;
}

export function toWireApiKey<
	T extends { readonly hash: string; readonly workspace: string },
>(rec: T) {
	const { workspace, ...rest } = stripHash(rec);
	return { workspaceId: workspace, ...rest };
}
