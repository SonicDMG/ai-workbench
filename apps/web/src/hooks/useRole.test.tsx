import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthConfig, Role, SessionSubject } from "@/lib/session";

vi.mock("@/lib/session", () => ({
	fetchAuthConfig: vi.fn(),
	fetchSessionSubject: vi.fn(),
	refreshSession: vi.fn(),
}));

import { fetchAuthConfig, fetchSessionSubject } from "@/lib/session";
import { useRole } from "./useRole";

function makeWrapper() {
	const qc = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	});
	function Wrapper({ children }: { children: ReactNode }) {
		return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
	}
	return { wrapper: Wrapper };
}

const LOGIN_ON: AuthConfig = {
	modes: { apiKey: true, oidc: true, login: true },
	loginPath: "/auth/login",
	refreshPath: "/auth/refresh",
};

const LOGIN_OFF: AuthConfig = {
	modes: { apiKey: true, oidc: false, login: false },
	loginPath: null,
	refreshPath: null,
};

function subject(
	role: Role | null,
	scopes: readonly string[] | null,
): SessionSubject {
	return {
		id: "u",
		label: "u",
		type: scopes === null ? "oidc" : "apiKey",
		workspaceScopes: null,
		role,
		scopes,
		expiresAt: null,
		canRefresh: false,
	};
}

describe("useRole", () => {
	beforeEach(() => {
		vi.mocked(fetchAuthConfig).mockReset();
		vi.mocked(fetchSessionSubject).mockReset();
	});

	it("defaults to permissive (canManage) when login is disabled — no signal to deny on", async () => {
		vi.mocked(fetchAuthConfig).mockResolvedValue(LOGIN_OFF);
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => useRole(), { wrapper });
		await waitFor(() => expect(vi.mocked(fetchAuthConfig)).toHaveBeenCalled());
		// Session query never fires when login is off → no subject → permissive.
		expect(result.current.canManage).toBe(true);
		expect(result.current.isAdmin).toBe(false);
		expect(result.current.role).toBeNull();
		expect(fetchSessionSubject).not.toHaveBeenCalled();
	});

	it("treats an admin role as able to manage", async () => {
		vi.mocked(fetchAuthConfig).mockResolvedValue(LOGIN_ON);
		vi.mocked(fetchSessionSubject).mockResolvedValue(
			subject("admin", ["read", "write", "manage"]),
		);
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => useRole(), { wrapper });
		await waitFor(() => expect(result.current.role).toBe("admin"));
		expect(result.current.canManage).toBe(true);
		expect(result.current.isAdmin).toBe(true);
	});

	it("denies manage for an editor", async () => {
		vi.mocked(fetchAuthConfig).mockResolvedValue(LOGIN_ON);
		vi.mocked(fetchSessionSubject).mockResolvedValue(
			subject("editor", ["read", "write"]),
		);
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => useRole(), { wrapper });
		await waitFor(() => expect(result.current.role).toBe("editor"));
		expect(result.current.canManage).toBe(false);
		expect(result.current.isAdmin).toBe(false);
	});

	it("denies manage for a viewer", async () => {
		vi.mocked(fetchAuthConfig).mockResolvedValue(LOGIN_ON);
		vi.mocked(fetchSessionSubject).mockResolvedValue(
			subject("viewer", ["read"]),
		);
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => useRole(), { wrapper });
		await waitFor(() => expect(result.current.role).toBe("viewer"));
		expect(result.current.canManage).toBe(false);
	});

	it("allows manage for an unscoped subject (scopes: null = all)", async () => {
		vi.mocked(fetchAuthConfig).mockResolvedValue(LOGIN_ON);
		// OIDC without a role mapping → role null, scopes null.
		vi.mocked(fetchSessionSubject).mockResolvedValue(subject(null, null));
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => useRole(), { wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));
		expect(result.current.canManage).toBe(true);
		expect(result.current.role).toBeNull();
	});

	it("keys off the concrete scope list when role is absent but manage is present", async () => {
		vi.mocked(fetchAuthConfig).mockResolvedValue(LOGIN_ON);
		// API-key-shaped subject: no role, concrete scopes including manage.
		vi.mocked(fetchSessionSubject).mockResolvedValue(
			subject(null, ["read", "write", "manage"]),
		);
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => useRole(), { wrapper });
		await waitFor(() => expect(result.current.isLoading).toBe(false));
		expect(result.current.canManage).toBe(true);
	});
});
