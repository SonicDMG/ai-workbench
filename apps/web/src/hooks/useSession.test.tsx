import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthConfig, SessionSubject } from "@/lib/session";

vi.mock("@/lib/session", () => ({
	fetchAuthConfig: vi.fn(),
	fetchSessionSubject: vi.fn(),
	refreshSession: vi.fn(),
}));

import {
	fetchAuthConfig,
	fetchSessionSubject,
	refreshSession,
} from "@/lib/session";
import { useAuthConfig, useSession, useSilentRefresh } from "./useSession";

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
	return { wrapper: Wrapper, qc };
}

const FULL_AUTH_CONFIG: AuthConfig = {
	modes: { apiKey: true, oidc: true, login: true },
	loginPath: "/auth/oidc/login",
	refreshPath: "/auth/oidc/refresh",
};

const LOGIN_DISABLED: AuthConfig = {
	modes: { apiKey: true, oidc: false, login: false },
	loginPath: null,
	refreshPath: null,
};

const ACTIVE_SUBJECT: SessionSubject = {
	id: "alice",
	label: "Alice",
	type: "oidc",
	workspaceScopes: null,
	expiresAt: Math.floor(Date.now() / 1000) + 600, // 10 min from now
	canRefresh: true,
};

const OPAQUE_SUBJECT: SessionSubject = {
	...ACTIVE_SUBJECT,
	expiresAt: null,
};

const NO_REFRESH_SUBJECT: SessionSubject = {
	...ACTIVE_SUBJECT,
	canRefresh: false,
};

describe("useAuthConfig", () => {
	it("returns the fetched config payload", async () => {
		vi.mocked(fetchAuthConfig).mockResolvedValueOnce(FULL_AUTH_CONFIG);
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => useAuthConfig(), { wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toEqual(FULL_AUTH_CONFIG);
	});
});

describe("useSession (gated on auth config)", () => {
	it("does not fire fetchSessionSubject until auth config arrives", () => {
		// fetchAuthConfig pending forever.
		vi.mocked(fetchAuthConfig).mockReturnValueOnce(
			new Promise(() => {}) as ReturnType<typeof fetchAuthConfig>,
		);
		const { wrapper } = makeWrapper();
		renderHook(() => useSession(), { wrapper });
		expect(fetchSessionSubject).not.toHaveBeenCalled();
	});

	it("does not fire fetchSessionSubject when login mode is disabled", async () => {
		vi.mocked(fetchAuthConfig).mockResolvedValueOnce(LOGIN_DISABLED);
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => useSession(), { wrapper });
		await waitFor(() => expect(vi.mocked(fetchAuthConfig)).toHaveBeenCalled());
		// Wait a tick to ensure the dependent query also gets a chance.
		await new Promise((r) => setTimeout(r, 5));
		expect(fetchSessionSubject).not.toHaveBeenCalled();
		expect(result.current.fetchStatus).toBe("idle");
	});

	it("fires fetchSessionSubject once auth config reports login:true", async () => {
		vi.mocked(fetchAuthConfig).mockResolvedValueOnce(FULL_AUTH_CONFIG);
		vi.mocked(fetchSessionSubject).mockResolvedValueOnce(ACTIVE_SUBJECT);
		const { wrapper } = makeWrapper();
		const { result } = renderHook(() => useSession(), { wrapper });
		await waitFor(() => expect(result.current.isSuccess).toBe(true));
		expect(result.current.data).toEqual(ACTIVE_SUBJECT);
	});
});

describe("useSilentRefresh", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("is a no-op when refreshPath is absent", async () => {
		vi.mocked(fetchAuthConfig).mockResolvedValueOnce(LOGIN_DISABLED);
		vi.mocked(fetchSessionSubject).mockResolvedValueOnce(ACTIVE_SUBJECT);
		const { wrapper } = makeWrapper();
		renderHook(() => useSilentRefresh(), { wrapper });
		// Advance well past any plausible refresh threshold.
		await act(async () => {
			vi.advanceTimersByTime(60 * 60 * 1000);
		});
		expect(refreshSession).not.toHaveBeenCalled();
	});

	it("is a no-op when the session is opaque (no expiresAt)", async () => {
		vi.mocked(fetchAuthConfig).mockResolvedValueOnce(FULL_AUTH_CONFIG);
		vi.mocked(fetchSessionSubject).mockResolvedValueOnce(OPAQUE_SUBJECT);
		const { wrapper } = makeWrapper();
		renderHook(() => useSilentRefresh(), { wrapper });
		await act(async () => {
			vi.advanceTimersByTime(60 * 60 * 1000);
		});
		expect(refreshSession).not.toHaveBeenCalled();
	});

	it("is a no-op when canRefresh is false", async () => {
		vi.mocked(fetchAuthConfig).mockResolvedValueOnce(FULL_AUTH_CONFIG);
		vi.mocked(fetchSessionSubject).mockResolvedValueOnce(NO_REFRESH_SUBJECT);
		const { wrapper } = makeWrapper();
		renderHook(() => useSilentRefresh(), { wrapper });
		await act(async () => {
			vi.advanceTimersByTime(60 * 60 * 1000);
		});
		expect(refreshSession).not.toHaveBeenCalled();
	});

	it("schedules a refresh at ~80% of remaining lifetime when everything is wired", async () => {
		vi.mocked(fetchAuthConfig).mockResolvedValueOnce(FULL_AUTH_CONFIG);
		const expiresAt = Math.floor(Date.now() / 1000) + 600; // 600s = 10 min
		const subject: SessionSubject = {
			...ACTIVE_SUBJECT,
			expiresAt,
		};
		vi.mocked(fetchSessionSubject).mockResolvedValueOnce(subject);
		vi.mocked(refreshSession).mockResolvedValueOnce({
			ok: true,
			expiresAt: expiresAt + 600,
		});
		const { wrapper } = makeWrapper();
		renderHook(() => useSilentRefresh(), { wrapper });
		// Let the queries resolve so the effect schedules its timeout.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(0);
		});
		// 80% of 600s = 480s; clamped into [30s, 30min].
		await act(async () => {
			await vi.advanceTimersByTimeAsync(479_000);
		});
		expect(refreshSession).not.toHaveBeenCalled();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(2_000); // cross the 480s mark
		});
		expect(refreshSession).toHaveBeenCalledWith(FULL_AUTH_CONFIG.refreshPath);
	});
});
