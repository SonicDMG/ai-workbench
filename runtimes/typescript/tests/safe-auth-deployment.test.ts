import { describe, expect, test } from "vitest";
import { assertSafeAuthDeployment } from "../src/auth/deployment-guard.js";

const MEMORY_CP = { driver: "memory" as const };
const ASTRA_CP = { driver: "astra" as const };
const FILE_CP = { driver: "file" as const };

const SAFE_AUTH = {
	mode: "apiKey",
	anonymousPolicy: "reject",
	acknowledgeOpenAccess: false,
	bootstrapTokenRef: null,
};

describe("assertSafeAuthDeployment", () => {
	test("memory control plane is always allowed", () => {
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

	test("astra control plane with apiKey/reject is allowed", () => {
		expect(() =>
			assertSafeAuthDeployment({
				controlPlane: ASTRA_CP,
				auth: SAFE_AUTH,
			}),
		).not.toThrow();
	});

	test("file control plane with auth.mode=disabled is rejected", () => {
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
		).toThrow(/refusing to start with unsafe auth/);
	});

	test("astra control plane with anonymousPolicy=allow is rejected", () => {
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

	test("acknowledgeOpenAccess: true allows the open-auth combination", () => {
		expect(() =>
			assertSafeAuthDeployment({
				controlPlane: ASTRA_CP,
				auth: {
					mode: "disabled",
					anonymousPolicy: "allow",
					acknowledgeOpenAccess: true,
					bootstrapTokenRef: null,
				},
			}),
		).not.toThrow();
	});

	test("OIDC client without sessionSecretRef on file CP is rejected", () => {
		expect(() =>
			assertSafeAuthDeployment({
				controlPlane: FILE_CP,
				auth: {
					mode: "oidc",
					anonymousPolicy: "reject",
					acknowledgeOpenAccess: false,
					bootstrapTokenRef: null,
					oidc: {
						client: { sessionSecretRef: null },
					},
				},
			}),
		).toThrow(/sessionSecretRef is required/);
	});

	test("OIDC client without sessionSecretRef cannot be opted out via acknowledgeOpenAccess", () => {
		// `acknowledgeOpenAccess` only excuses open auth — the session-key
		// requirement is unconditional because an ephemeral key is broken
		// across replicas regardless of whether the proxy auths upstream.
		expect(() =>
			assertSafeAuthDeployment({
				controlPlane: ASTRA_CP,
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
					acknowledgeOpenAccess: false,
					bootstrapTokenRef: null,
					oidc: {
						client: { sessionSecretRef: "env:WB_SESSION_KEY" },
					},
				},
			}),
		).not.toThrow();
	});

	test("error message names the control plane driver", () => {
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
