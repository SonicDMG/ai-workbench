/**
 * Shared endpoint mixin for the four execution-service aggregates
 * (chunking, embedding, reranking, llm). Each service row carries the
 * same network-call configuration; this type captures the common
 * fields so the per-aggregate inputs can `extends` it without
 * duplicating the seven-field shape.
 *
 * The leading underscore in the filename flags this as repos-internal;
 * external consumers should import the per-service input types from
 * the relevant repo file (e.g. `repos/embedding-services.ts`).
 */

import type { AuthType, SecretRef } from "../types.js";

export interface ServiceEndpointInput {
	readonly endpointBaseUrl?: string | null;
	readonly endpointPath?: string | null;
	readonly requestTimeoutMs?: number | null;
	readonly authType?: AuthType;
	readonly credentialRef?: SecretRef | null;
}
