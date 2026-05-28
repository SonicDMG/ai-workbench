import { describe, expect, test } from "vitest";
import { ConfigSchema } from "../src/config/schema.js";

describe("ConfigSchema", () => {
	test("falls back to the file driver when no controlPlane block is set and no Astra env vars", () => {
		// Default control plane: prefer Astra when env vars are
		// populated (the boot-time astra-cli detection wires those
		// up automatically when a profile exists), fall back to
		// JSON-on-disk under `./.workbench-data/` otherwise. This
		// test runs without Astra creds so the fallback path is
		// exercised; the env-driven branch is covered by the
		// "auto-picks astra" test below.
		const prevEndpoint = process.env.ASTRA_DB_API_ENDPOINT;
		const prevToken = process.env.ASTRA_DB_APPLICATION_TOKEN;
		delete process.env.ASTRA_DB_API_ENDPOINT;
		delete process.env.ASTRA_DB_APPLICATION_TOKEN;
		try {
			const cfg = ConfigSchema.parse({ version: 1 });
			expect(cfg.runtime.environment).toBe("development");
			expect(cfg.runtime.port).toBe(8080);
			expect(cfg.runtime.logLevel).toBe("info");
			expect(cfg.runtime.uiDir).toBe(null);
			expect(cfg.runtime.publicOrigin).toBe(null);
			expect(cfg.runtime.trustProxyHeaders).toBe(false);
			expect(cfg.controlPlane.driver).toBe("file");
			expect(cfg.seedWorkspaces).toEqual([]);
		} finally {
			if (prevEndpoint !== undefined)
				process.env.ASTRA_DB_API_ENDPOINT = prevEndpoint;
			if (prevToken !== undefined)
				process.env.ASTRA_DB_APPLICATION_TOKEN = prevToken;
		}
	});

	test("auto-picks the astra driver when ASTRA_DB_API_ENDPOINT + ASTRA_DB_APPLICATION_TOKEN are set", () => {
		// Default control plane: when the canonical Astra env vars are
		// populated, the schema's smart default routes all workspace /
		// agent / KB metadata into Astra Data API Tables — no
		// `controlPlane:` stanza required.
		const prevEndpoint = process.env.ASTRA_DB_API_ENDPOINT;
		const prevToken = process.env.ASTRA_DB_APPLICATION_TOKEN;
		const prevKeyspace = process.env.ASTRA_DB_KEYSPACE;
		process.env.ASTRA_DB_API_ENDPOINT =
			"https://abc-def.apps.astra.datastax.com";
		process.env.ASTRA_DB_APPLICATION_TOKEN = "AstraCS:test:token";
		delete process.env.ASTRA_DB_KEYSPACE;
		try {
			const cfg = ConfigSchema.parse({ version: 1 });
			expect(cfg.controlPlane.driver).toBe("astra");
			if (cfg.controlPlane.driver === "astra") {
				expect(cfg.controlPlane.endpoint).toBe(
					"https://abc-def.apps.astra.datastax.com",
				);
				expect(cfg.controlPlane.tokenRef).toBe(
					"env:ASTRA_DB_APPLICATION_TOKEN",
				);
				// Astra DB auto-creates `default_keyspace` on every new
				// database, so the smart default lands somewhere that
				// already exists out of the box.
				expect(cfg.controlPlane.keyspace).toBe("default_keyspace");
			}
		} finally {
			if (prevEndpoint !== undefined)
				process.env.ASTRA_DB_API_ENDPOINT = prevEndpoint;
			else delete process.env.ASTRA_DB_API_ENDPOINT;
			if (prevToken !== undefined)
				process.env.ASTRA_DB_APPLICATION_TOKEN = prevToken;
			else delete process.env.ASTRA_DB_APPLICATION_TOKEN;
			if (prevKeyspace !== undefined)
				process.env.ASTRA_DB_KEYSPACE = prevKeyspace;
		}
	});

	test("respects ASTRA_DB_KEYSPACE override on the auto-picked astra driver", () => {
		const prevEndpoint = process.env.ASTRA_DB_API_ENDPOINT;
		const prevToken = process.env.ASTRA_DB_APPLICATION_TOKEN;
		const prevKeyspace = process.env.ASTRA_DB_KEYSPACE;
		process.env.ASTRA_DB_API_ENDPOINT =
			"https://abc-def.apps.astra.datastax.com";
		process.env.ASTRA_DB_APPLICATION_TOKEN = "AstraCS:test:token";
		process.env.ASTRA_DB_KEYSPACE = "custom_ks";
		try {
			const cfg = ConfigSchema.parse({ version: 1 });
			expect(cfg.controlPlane.driver).toBe("astra");
			if (cfg.controlPlane.driver === "astra") {
				expect(cfg.controlPlane.keyspace).toBe("custom_ks");
			}
		} finally {
			if (prevEndpoint !== undefined)
				process.env.ASTRA_DB_API_ENDPOINT = prevEndpoint;
			else delete process.env.ASTRA_DB_API_ENDPOINT;
			if (prevToken !== undefined)
				process.env.ASTRA_DB_APPLICATION_TOKEN = prevToken;
			else delete process.env.ASTRA_DB_APPLICATION_TOKEN;
			if (prevKeyspace !== undefined)
				process.env.ASTRA_DB_KEYSPACE = prevKeyspace;
			else delete process.env.ASTRA_DB_KEYSPACE;
		}
	});

	test("accepts explicit memory driver with seeds", () => {
		const cfg = ConfigSchema.parse({
			version: 1,
			controlPlane: { driver: "memory" },
			seedWorkspaces: [{ name: "demo", kind: "mock" }],
		});
		expect(cfg.seedWorkspaces).toHaveLength(1);
		expect(cfg.seedWorkspaces[0]?.kind).toBe("mock");
	});

	test("accepts a file driver with a root", () => {
		const cfg = ConfigSchema.parse({
			version: 1,
			controlPlane: { driver: "file", root: "/var/lib/workbench" },
		});
		expect(cfg.controlPlane.driver).toBe("file");
	});

	test("accepts an astra driver with endpoint + tokenRef", () => {
		const cfg = ConfigSchema.parse({
			version: 1,
			controlPlane: {
				driver: "astra",
				endpoint: "https://x.apps.astra.datastax.com",
				tokenRef: "env:ASTRA_TOKEN",
			},
		});
		expect(cfg.controlPlane.driver).toBe("astra");
		if (cfg.controlPlane.driver === "astra") {
			// Default keyspace falls back to Astra DB's auto-created
			// `default_keyspace` when the user doesn't specify one,
			// so the runtime can boot against a fresh database
			// without a manual keyspace-create step.
			expect(cfg.controlPlane.keyspace).toBe("default_keyspace");
		}
	});

	test("accepts a bootstrap token ref for strict auth modes", () => {
		const cfg = ConfigSchema.parse({
			version: 1,
			auth: {
				mode: "apiKey",
				anonymousPolicy: "reject",
				bootstrapTokenRef: "env:WB_BOOTSTRAP_TOKEN",
			},
		});
		expect(cfg.auth.bootstrapTokenRef).toBe("env:WB_BOOTSTRAP_TOKEN");
	});

	test("accepts a hardened production config", () => {
		const cfg = ConfigSchema.parse({
			version: 1,
			runtime: {
				environment: "production",
				publicOrigin: "https://workbench.example.com",
			},
			controlPlane: { driver: "file", root: "/var/lib/workbench" },
			auth: {
				mode: "apiKey",
				anonymousPolicy: "reject",
				bootstrapTokenRef: "env:WB_BOOTSTRAP_TOKEN",
			},
		});
		expect(cfg.runtime.environment).toBe("production");
		expect(cfg.runtime.publicOrigin).toBe("https://workbench.example.com");
	});

	test("rejects production config with memory, disabled auth, or anonymous access", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				runtime: { environment: "production" },
				controlPlane: { driver: "memory" },
				auth: { mode: "disabled", anonymousPolicy: "allow" },
			}),
		).toThrow(/durable control plane/);
	});

	test("rejects production OIDC browser login without persistent session key and public origin", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				runtime: { environment: "production" },
				controlPlane: { driver: "file", root: "/var/lib/workbench" },
				auth: {
					mode: "oidc",
					anonymousPolicy: "reject",
					oidc: {
						issuer: "https://idp.example.com",
						audience: "ai-workbench",
						client: {
							clientId: "client",
						},
					},
				},
			}),
		).toThrow(/sessionSecretRef/);
	});

	test("rejects non-https public origins in production", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				runtime: {
					environment: "production",
					publicOrigin: "http://workbench.example.com",
				},
				controlPlane: { driver: "file", root: "/var/lib/workbench" },
				auth: {
					mode: "apiKey",
					anonymousPolicy: "reject",
					bootstrapTokenRef: "env:WB_BOOTSTRAP_TOKEN",
				},
			}),
		).toThrow(/publicOrigin to use https/);
	});

	test("rejects unknown schema version", () => {
		expect(() => ConfigSchema.parse({ version: 2 })).toThrow();
	});

	test("rejects unknown control-plane driver", () => {
		expect(() =>
			ConfigSchema.parse({ version: 1, controlPlane: { driver: "oracle" } }),
		).toThrow();
	});

	test("rejects file driver without root", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				controlPlane: { driver: "file" },
			}),
		).toThrow();
	});

	test("rejects astra driver with malformed tokenRef", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				controlPlane: {
					driver: "astra",
					endpoint: "https://x.apps.astra.datastax.com",
					tokenRef: "plain-string-no-prefix",
				},
			}),
		).toThrow();
	});

	test("accepts astra-cli secret refs in tokenRef", () => {
		// `astra-cli:<profile>:<dbId>:token` — the provider portion has a
		// hyphen and the path itself contains further colons. The schema
		// must allow URI-scheme-style providers and only split on the
		// first colon.
		const cfg = ConfigSchema.parse({
			version: 1,
			controlPlane: {
				driver: "astra",
				endpoint: "https://x.apps.astra.datastax.com",
				tokenRef:
					"astra-cli:default:c933e7fc-4996-4dcd-bb87-4f282fe1e7ef:token",
			},
		});
		if (cfg.controlPlane.driver === "astra") {
			expect(cfg.controlPlane.tokenRef).toBe(
				"astra-cli:default:c933e7fc-4996-4dcd-bb87-4f282fe1e7ef:token",
			);
		}
	});

	test("rejects bootstrap token refs when auth is disabled", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				auth: {
					mode: "disabled",
					anonymousPolicy: "allow",
					bootstrapTokenRef: "env:WB_BOOTSTRAP_TOKEN",
				},
			}),
		).toThrow(/only valid when auth.mode/);
	});

	test("rejects seedWorkspaces when driver is not memory", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				controlPlane: { driver: "file", root: "/tmp/x" },
				seedWorkspaces: [{ name: "demo", kind: "mock" }],
			}),
		).toThrow(/only meaningful with controlPlane.driver='memory'/);
	});

	test("rejects jobsResume.enabled with memory control plane", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				controlPlane: {
					driver: "memory",
					jobsResume: { enabled: true },
				},
			}),
		).toThrow(/jobsResume requires a durable control plane/);
	});

	test("accepts jobsResume.enabled with file control plane", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				controlPlane: {
					driver: "file",
					root: "/tmp/x",
					jobsResume: { enabled: true },
				},
			}),
		).not.toThrow();
	});

	test("rejects duplicate seed workspace names", () => {
		expect(() =>
			ConfigSchema.parse({
				version: 1,
				seedWorkspaces: [
					{ name: "a", kind: "mock" },
					{ name: "a", kind: "astra" },
				],
			}),
		).toThrow(/duplicate seed workspace name/);
	});

	test("chat is enabled by default with HuggingFace defaults when no `chat:` block is supplied", () => {
		const cfg = ConfigSchema.parse({ version: 1 });
		expect(cfg.chat.enabled).toBe(true);
		expect(cfg.chat.tokenRef).toBe("env:HUGGINGFACE_API_KEY");
		expect(cfg.chat.model).toBe("Qwen/Qwen2.5-7B-Instruct");
		expect(cfg.chat.maxOutputTokens).toBe(1024);
		expect(cfg.chat.retrievalK).toBe(6);
		expect(cfg.chat.systemPrompt).toBeNull();
	});

	test("chat block accepts a single-field opt-out (`chat: { enabled: false }`)", () => {
		const cfg = ConfigSchema.parse({
			version: 1,
			chat: { enabled: false },
		});
		expect(cfg.chat.enabled).toBe(false);
		// Defaults still apply for the other fields — the explicit opt-out
		// is a behavior toggle, not a shape change.
		expect(cfg.chat.tokenRef).toBe("env:HUGGINGFACE_API_KEY");
	});

	test("explicit chat tokenRef + model override the defaults", () => {
		const cfg = ConfigSchema.parse({
			version: 1,
			chat: {
				tokenRef: "env:MY_HF_TOKEN",
				model: "meta-llama/Llama-3.1-8B-Instruct",
			},
		});
		expect(cfg.chat.enabled).toBe(true);
		expect(cfg.chat.tokenRef).toBe("env:MY_HF_TOKEN");
		expect(cfg.chat.model).toBe("meta-llama/Llama-3.1-8B-Instruct");
	});
});
