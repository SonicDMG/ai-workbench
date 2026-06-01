import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ControlPlaneStore } from "../src/control-plane/store.js";
import { operationalRoutes } from "../src/routes/operational.js";

/**
 * `/readyz` must fail fast on a hung control plane rather than holding
 * the request open for the driver's full socket timeout. The handler
 * wraps `store.listWorkspaces()` in a hard wall-clock (`withDeadline`),
 * so a backend that never resolves surfaces a 503 the instant the
 * deadline fires. These tests drive that path with fake timers.
 */

/**
 * Minimal fake store: only `listWorkspaces` is exercised by `/readyz`.
 * The rest of the (large) `ControlPlaneStore` surface is cast away —
 * the readiness handler never touches it.
 */
function storeWith(
	listWorkspaces: () => Promise<unknown[]>,
): ControlPlaneStore {
	return { listWorkspaces } as unknown as ControlPlaneStore;
}

describe("GET /readyz wall-clock bound", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test("returns 503 control_plane_unavailable when listWorkspaces hangs past the deadline", async () => {
		// A control plane that never resolves — emulates a hung Astra
		// connection that ignores aborts.
		const store = storeWith(() => new Promise<unknown[]>(() => {}));
		const app = operationalRoutes(store);

		const resPromise = app.request("/readyz");
		// Advance past the 4s readiness deadline so `withDeadline` rejects.
		await vi.advanceTimersByTimeAsync(4_001);
		const res = await resPromise;

		expect(res.status).toBe(503);
		const body = (await res.json()) as {
			error: { code: string; message: string };
		};
		expect(body.error.code).toBe("control_plane_unavailable");
		expect(body.error.message).toMatch(/did not respond within 4000ms/);
	});

	test("returns 503 when listWorkspaces rejects outright", async () => {
		const store = storeWith(() =>
			Promise.reject(new Error("ECONNREFUSED 10.0.0.1:9042")),
		);
		const app = operationalRoutes(store);

		const res = await app.request("/readyz");

		expect(res.status).toBe(503);
		const body = (await res.json()) as {
			error: { code: string; message: string };
		};
		expect(body.error.code).toBe("control_plane_unavailable");
		expect(body.error.message).toMatch(/unreachable/);
		expect(body.error.message).toContain("ECONNREFUSED");
	});

	test("returns 200 ready with the workspace count on a healthy control plane", async () => {
		const store = storeWith(() =>
			Promise.resolve([{ workspaceId: "a" }, { workspaceId: "b" }]),
		);
		const app = operationalRoutes(store);

		const res = await app.request("/readyz");

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			status: string;
			workspaces: number;
		};
		expect(body.status).toBe("ready");
		expect(body.workspaces).toBe(2);
	});

	test("reports 503 draining before it ever probes the control plane", async () => {
		// A draining runtime must short-circuit to 503 without calling
		// listWorkspaces at all.
		const listWorkspaces = vi.fn(() => Promise.resolve([]));
		const app = operationalRoutes(storeWith(listWorkspaces), {
			draining: true,
		});

		const res = await app.request("/readyz");

		expect(res.status).toBe(503);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe("draining");
		expect(listWorkspaces).not.toHaveBeenCalled();
	});
});
