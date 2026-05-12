import { type UseMutationResult, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { ConnectVerifyResponse } from "@/lib/schemas";

/**
 * Drive the Connect tab's **Test** button: posts to
 * `POST /api/v1/workspaces/{w}/connect/verify` and surfaces the
 * outcome envelope. Modelled as a mutation (not a query) because
 * verification is user-initiated and side-effecting from the user's
 * mental model — clicking the button should reissue, never serve a
 * cached result.
 *
 * The server always returns 200 with a structured envelope, so the
 * mutation only enters `isError` for transport-level failures (the
 * runtime itself unreachable, auth gate, etc.). MCP-off / verify-
 * failed live inside the success envelope as `ok: false`.
 */
export function useConnectVerify(
	workspaceId: string | undefined,
): UseMutationResult<ConnectVerifyResponse, Error, void> {
	return useMutation({
		mutationFn: () => {
			if (!workspaceId) {
				throw new Error("useConnectVerify requires a workspaceId");
			}
			return api.verifyConnectEndpoint(workspaceId);
		},
	});
}
