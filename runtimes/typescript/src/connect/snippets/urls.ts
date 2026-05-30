/**
 * URL helpers shared across the per-framework snippet generators.
 *
 * Kept here (not in `lib/public-url.ts`) because these concatenations
 * are specific to the Connect surface — the rest of the runtime never
 * has to assemble `/api/v1/workspaces/{w}/mcp` from parts.
 */

export function mcpUrl(publicBaseUrl: string, workspaceId: string): string {
	return `${publicBaseUrl}/api/v1/workspaces/${workspaceId}/mcp`;
}

export function restBaseUrl(publicBaseUrl: string): string {
	return `${publicBaseUrl}/api/v1`;
}
