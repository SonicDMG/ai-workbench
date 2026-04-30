/**
 * Per-resource repository for the in-memory API-key surface.
 *
 * First slice of the store-decomposition effort tracked in the
 * audit's item #5: split each control-plane store (memory / file /
 * astra) — currently ~2k lines each — into per-resource repositories
 * that own the maps + methods for one logical group. The store class
 * becomes a thin coordinator.
 *
 * API keys is the simplest group to extract first: only depends on
 * the workspace existence check (passed in as `assertWorkspace`),
 * and the cascade is one-way (deleting a workspace clears its keys,
 * not the reverse). Other groups (chat / agent / conversation) have
 * cross-cascade dependencies that need a richer split — they follow
 * this same template once the boundary is proven.
 */

import { byCreatedAtThenKeyId, nowIso } from "../defaults.js";
import { ControlPlaneConflictError } from "../errors.js";
import type { PersistApiKeyInput } from "../store.js";
import type { ApiKeyRecord } from "../types.js";

export class MemoryApiKeyRepository {
	private readonly apiKeys = new Map<string, Map<string, ApiKeyRecord>>();
	private readonly apiKeyPrefixIndex = new Map<string, ApiKeyRecord>();

	constructor(
		private readonly assertWorkspace: (workspace: string) => Promise<void>,
	) {}

	async list(workspace: string): Promise<readonly ApiKeyRecord[]> {
		await this.assertWorkspace(workspace);
		return Array.from(this.apiKeys.get(workspace)?.values() ?? []).sort(
			byCreatedAtThenKeyId,
		);
	}

	async get(workspace: string, keyId: string): Promise<ApiKeyRecord | null> {
		await this.assertWorkspace(workspace);
		return this.apiKeys.get(workspace)?.get(keyId) ?? null;
	}

	async persist(
		workspace: string,
		input: PersistApiKeyInput,
	): Promise<ApiKeyRecord> {
		await this.assertWorkspace(workspace);
		if (this.apiKeyPrefixIndex.has(input.prefix)) {
			throw new ControlPlaneConflictError(
				`api key with prefix '${input.prefix}' already exists`,
			);
		}
		const bucket = this.apiKeys.get(workspace) ?? new Map();
		if (bucket.has(input.keyId)) {
			throw new ControlPlaneConflictError(
				`api key with id '${input.keyId}' already exists in workspace '${workspace}'`,
			);
		}
		const now = nowIso();
		const record: ApiKeyRecord = {
			workspace,
			keyId: input.keyId,
			prefix: input.prefix,
			hash: input.hash,
			label: input.label,
			createdAt: now,
			lastUsedAt: null,
			revokedAt: null,
			expiresAt: input.expiresAt ?? null,
		};
		bucket.set(input.keyId, record);
		this.apiKeys.set(workspace, bucket);
		this.apiKeyPrefixIndex.set(input.prefix, record);
		return record;
	}

	async revoke(
		workspace: string,
		keyId: string,
	): Promise<{ revoked: boolean }> {
		await this.assertWorkspace(workspace);
		const existing = this.apiKeys.get(workspace)?.get(keyId);
		if (!existing) return { revoked: false };
		if (existing.revokedAt !== null) return { revoked: false };
		const revoked: ApiKeyRecord = { ...existing, revokedAt: nowIso() };
		this.apiKeys.get(workspace)?.set(keyId, revoked);
		this.apiKeyPrefixIndex.set(existing.prefix, revoked);
		return { revoked: true };
	}

	async findByPrefix(prefix: string): Promise<ApiKeyRecord | null> {
		return this.apiKeyPrefixIndex.get(prefix) ?? null;
	}

	async touch(workspace: string, keyId: string): Promise<void> {
		const existing = this.apiKeys.get(workspace)?.get(keyId);
		if (!existing) return;
		const touched: ApiKeyRecord = { ...existing, lastUsedAt: nowIso() };
		this.apiKeys.get(workspace)?.set(keyId, touched);
		this.apiKeyPrefixIndex.set(existing.prefix, touched);
	}

	/**
	 * Drop all keys for a workspace. Called from the workspace-delete
	 * cascade in the parent store.
	 */
	deleteAllForWorkspace(workspace: string): void {
		const bucket = this.apiKeys.get(workspace);
		if (!bucket) return;
		for (const record of bucket.values()) {
			this.apiKeyPrefixIndex.delete(record.prefix);
		}
		this.apiKeys.delete(workspace);
	}
}
