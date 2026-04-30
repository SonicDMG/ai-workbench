import { describe, expect, test } from "vitest";
import { assertSafeAuthDeployment } from "../src/auth/deployment-guard.js";

const MEMORY_CP = { driver: "memory" as const };
const ASTRA_CP = { driver: "astra" as const };
const FILE_CP = { driver: "file" as const };

const SAFE_AUTH = {
	mode: "apiKey",
	anonymousPolicy: "reject",
	acknowledgeOpenAccess: true,
	bootstrapTokenRef: null,
};

describe("assertSafeAuthDeployment", () => {
	test("memory control plane is always allowed regardless of auth posture", () => {
		expect(() =>
			assertSafeAuthDeployment({
				controlPlane: MEMORY_CP,
				auth: {
					mode: "disabled",
					anonymousPolicy: "allow",
					acknowledgeOpenAccess: false,
					bootstrapTokenRef: null,
				},
			}),
		).not.toThrow();
	});

	test("astra control plane with strict auth passes silently", () => {
		expect(() =>
			assertSafeAuthDeployment({
				controlPlane: ASTRA_CP,
				auth: SAFE_AUTH,
			}),
		).not.toThrow();
	});

	test("durable CP + open auth + acknowledgeOpenAccess: true (the default) warns but does NOT throw", () => {
		// The dev loop runs on file CP with default-disabled auth;
		// blocking startup here would break `npm run dev`. We rely on
		// the loud terminal banner to surface the risk instead.
		expect(() =>
			assertSafeAuthDeployment({
				controlPlane: FILE_CP,
				auth: {
					mode: "disabled",
					anonymousPolicy: "allow",
					acknowledgeOpenAccess: true,
					bootstrapTokenRef: null,
				},
			}),
		).not.toThrow();
	});

	test("durable CP + open auth + acknowledgeOpenAccess: false IS a fatal", () => {
		// Operators who want strict-mode behavior in CI / shared envs
		// flip the field back to false to convert the warning into a
		// startup error.
		expect(() =>
			assertSafeAuthDeployment({
				controlPlane: FILE_CP,
				auth: {
					mode: "disabled",
					anonymousPolicy: "allow",
					acknowledgeOpenAccess: false,
					bootstrapTokenRef: null,
				},
			}),
		).toThrow(/auth\.acknowledgeOpenAccess is false/);
	});

	test("astra control plane with anonymousPolicy=allow + ack: false is fatal", () => {
		expect(() =>
			assertSafeAuthDeployment({
				controlPlane: ASTRA_CP,
				auth: {
					mode: "apiKey",
					anonymousPolicy: "allow",
					acknowledgeOpenAccess: false,
					bootstrapTokenRef: null,
				},
			}),
		).toThrow(/anonymousPolicy='allow'/);
	});

	test("OIDC client without sessionSecretRef on file CP is fatal regardless of ack", () => {
		// The session-key requirement has no opt-out — an ephemeral
		// key invalidates browser sessions on restart and breaks
		// across replicas, so there's no scenario where defaulting it
		// makes sense on a non-memory CP.
		expect(() =>
			assertSafeAuthDeployment({
				controlPlane: FILE_CP,
				auth: {
					mode: "oidc",
					anonymousPolicy: "reject",
					acknowledgeOpenAccess: true,
					bootstrapTokenRef: null,
					oidc: {
						client: { sessionSecretRef: null },
					},
				},
			}),
		).toThrow(/sessionSecretRef is required/);
	});

	test("OIDC client with sessionSecretRef passes", () => {
		expect(() =>
			assertSafeAuthDeployment({
				controlPlane: ASTRA_CP,
				auth: {
					mode: "oidc",
					anonymousPolicy: "reject",
					acknowledgeOpenAccess: true,
					bootstrapTokenRef: null,
					oidc: {
						client: { sessionSecretRef: "env:WB_SESSION_KEY" },
					},
				},
			}),
		).not.toThrow();
	});

	test("strict-mode error names the control plane driver", () => {
		expect(() =>
			assertSafeAuthDeployment({
				controlPlane: FILE_CP,
				auth: {
					mode: "disabled",
					anonymousPolicy: "allow",
					acknowledgeOpenAccess: false,
					bootstrapTokenRef: null,
				},
			}),
		).toThrow(/'file' control plane/);
	});
});
