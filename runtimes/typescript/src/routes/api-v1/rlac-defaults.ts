/**
 * RLAC visibility defaulting, shared by the KB document **create** and
 * **ingest** routes (JSON text + multipart file).
 *
 * When the workspace has RLAC enabled *and* the request resolves to a
 * principal, an omitted `visibleTo` defaults to `[caller]` and an
 * omitted `ownerPrincipalId` defaults to the caller — **independently**
 * of each other: supplying one does not suppress the other's default.
 * With RLAC off, or no resolved principal, omitted fields stay omitted
 * (legacy, pre-RLAC behavior — the column is left untouched).
 *
 * This is the single source of truth for that rule; the three document
 * write paths used to inline it with subtly divergent owner-defaulting.
 */

export interface RlacVisibilityInput {
	readonly visibleTo?: readonly string[] | null;
	readonly ownerPrincipalId?: string | null;
}

export interface RlacVisibilityDefaults {
	readonly visibleTo?: readonly string[] | null;
	readonly ownerPrincipalId?: string;
}

export function resolveRlacDefaults(
	rlacEnabled: boolean,
	principal: { readonly id: string } | null,
	caller: RlacVisibilityInput,
): RlacVisibilityDefaults {
	// The principal id to fall back to, or undefined when defaulting
	// doesn't apply (RLAC off, or no resolved principal).
	const fallback = rlacEnabled && principal !== null ? principal.id : undefined;
	return {
		// An explicit `visibleTo` — including `null` ("hidden from RLAC,
		// admin-only") — is preserved; only an omitted field defaults.
		visibleTo:
			caller.visibleTo !== undefined
				? caller.visibleTo
				: fallback !== undefined
					? [fallback]
					: undefined,
		// Provenance only: `null` and omitted both mean "no owner given",
		// so either defaults to the caller — independently of visibleTo.
		ownerPrincipalId: caller.ownerPrincipalId ?? fallback,
	};
}
