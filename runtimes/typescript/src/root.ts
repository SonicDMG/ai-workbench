import { serve } from "@hono/node-server";
import { type AppLoginOptions, createApp } from "./app.js";
import { assertSafeAuthDeployment } from "./auth/deployment-guard.js";
import { buildAuthResolver } from "./auth/factory.js";
import {
	generateSessionKey,
	makeCookieSigner,
} from "./auth/oidc/login/cookie.js";
import { fetchOidcEndpoints } from "./auth/oidc/login/discovery.js";
import { MemoryPendingLoginStore } from "./auth/oidc/login/pending.js";
import { buildChatService } from "./chat/factory.js";
import {
	type AstraCliInfo,
	loadAstraFromCli,
	toAstraCliInfo,
} from "./config/astra-cli.js";
import { loadDotEnv } from "./config/env-file.js";
import { loadConfig, resolveConfigPath } from "./config/loader.js";
import type { AuthConfig } from "./config/schema.js";
import { controlPlaneFromConfig } from "./control-plane/factory.js";
import { buildVectorStoreDriverRegistry } from "./drivers/factory.js";
import { makeEmbedderFactory } from "./embeddings/factory.js";
import { buildJobStore } from "./jobs/factory.js";
import { IngestSemaphore, runBounded } from "./jobs/ingest-semaphore.js";
import { runKbIngestJob } from "./jobs/ingest-worker.js";
import { ResumeRegistry } from "./jobs/resume-registry.js";
import { JobOrphanSweeper } from "./jobs/sweeper.js";
import type { IngestInputSnapshot } from "./jobs/types.js";
import { applyLogLevel, logger } from "./lib/logger.js";
import { generateReplicaId } from "./lib/replica-id.js";
import { executeRespawn, planRespawn } from "./lib/respawn.js";
import { buildTelemetryEmitter } from "./lib/telemetry.js";
import { initOtelFromConfig, type OtelHandle } from "./lib/tracing.js";
import { setEndpointEgressPolicy } from "./openapi/schemas.js";
import { buildRescueApp, classifyBootError } from "./rescue/app.js";
import { AstraCliSecretProvider } from "./secrets/astra-cli.js";
import { EnvSecretProvider } from "./secrets/env.js";
import { FileSecretProvider } from "./secrets/file.js";
import { assertConfigSecretsResolvable } from "./secrets/preflight.js";
import { SecretResolver } from "./secrets/provider.js";
import { buildUiAssets, resolveUiDir } from "./ui/assets.js";
import { VERSION } from "./version.js";

async function main(): Promise<void> {
	// Load .env (repo-root by default) before anything reads `process.env`.
	const envFile = loadDotEnv();
	if (envFile.path) {
		logger.info(
			{ envFile: envFile.path, source: envFile.source },
			"loaded env file",
		);
	}
	if (envFile.managedEnvPath) {
		logger.info(
			{ managedEnvFile: envFile.managedEnvPath },
			"loaded managed env file (wizard / /settings)",
		);
	}

	// Optionally fill in ASTRA_DB_API_ENDPOINT / ASTRA_DB_APPLICATION_TOKEN
	// from the developer's astra-cli profile when those env vars aren't
	// already set. No-op when the CLI isn't installed or both variables
	// are already present.
	const astraCliResult = await loadAstraFromCli({
		logger: {
			info: (msg, fields) => logger.info(fields ?? {}, msg),
			warn: (msg, fields) => logger.warn(fields ?? {}, msg),
			debug: (msg, fields) => logger.debug(fields ?? {}, msg),
		},
	});
	if (astraCliResult.status === "loaded") {
		logger.info(
			{
				profile: astraCliResult.profile,
				database: astraCliResult.database.name,
				region: astraCliResult.database.region,
			},
			"astra-cli credentials applied",
		);
	}
	const astraCli: AstraCliInfo = toAstraCliInfo(astraCliResult);

	const configPath = resolveConfigPath();
	logger.info({ configPath }, "loading config");

	const config = await loadConfig(configPath);

	const logLevel = applyLogLevel(config.runtime.logLevel);
	logger.info(
		{ level: logLevel.level, source: logLevel.source },
		"log level set",
	);

	// Optional OpenTelemetry SDK init. When `runtime.tracing.enabled`
	// is true we start a NodeSDK + OTLP HTTP trace exporter + the
	// auto-instrumentations bundle. When false (the default), the
	// runtime still creates manual server spans through
	// `@opentelemetry/api`, but they are no-ops without a registered
	// SDK. For full HTTP/fetch auto-instrumentation, operators can
	// preload the SDK via `node --import ./dist/lib/tracing-preload.js`.
	const otel: OtelHandle | null = await initOtelFromConfig(
		config.runtime.tracing,
	);

	// Layered SSRF defense. Production environments always block
	// RFC1918 / loopback / IPv6 unique-local hosts on operator-supplied
	// service endpoint URLs; development opts in via
	// `runtime.blockPrivateNetworkEndpoints`.
	const blockPrivateNetworks =
		config.runtime.environment === "production" ||
		config.runtime.blockPrivateNetworkEndpoints;
	setEndpointEgressPolicy({ blockPrivateNetworks });
	logger.info({ blockPrivateNetworks }, "endpoint egress policy set");

	const secrets = new SecretResolver({
		env: new EnvSecretProvider(),
		file: new FileSecretProvider(),
		// `astra-cli:<profile>:<dbId>:<token|endpoint>` — workspace creds
		// can name a specific astra-cli profile + database directly,
		// independent of whatever the boot-time picker chose for the
		// control plane. See `secrets/astra-cli.ts`.
		"astra-cli": new AstraCliSecretProvider(),
	});

	// Fail-fast on missing required secrets (Astra control-plane token,
	// OIDC session/client secrets, chat token, ...). Catches config
	// mismatches at boot instead of on the first request that needs the
	// secret.
	await assertConfigSecretsResolvable(config, secrets, { logger });

	// Resolve UI up-front so the rescue app (if we need it) can serve
	// the SPA. Resolution is pure-filesystem and can't fail in a way
	// that needs degraded handling.
	const uiDir = resolveUiDir(config.runtime.uiDir);
	const ui = uiDir ? buildUiAssets(uiDir) : null;

	// Control-plane init is the most common boot-failure surface:
	// typo'd Astra endpoint (ENOTFOUND), revoked token (401), region
	// hibernated past the resume window. Catch those classes here and
	// pivot to a minimal "rescue" HTTP app that lets the operator
	// paste corrected credentials via /settings instead of dying with
	// no in-app remediation.
	let store: Awaited<ReturnType<typeof controlPlaneFromConfig>>["store"];
	let astraTables: Awaited<
		ReturnType<typeof controlPlaneFromConfig>
	>["astraTables"];
	try {
		({ store, astraTables } = await controlPlaneFromConfig(config, secrets));
	} catch (bootErr) {
		const classified = classifyBootError(bootErr);
		logger.error(
			{ code: classified.code, message: classified.message },
			"control-plane init failed — entering rescue mode (HTTP server up, /api/v1/* returns 503, /settings reachable for credential fix)",
		);
		const rescueApp = buildRescueApp({
			bootError: classified,
			triggerRestart: () => triggerRespawnAndShutdown(logger),
			ui,
		});
		const rescuePort = config.runtime.port;
		serve({ fetch: rescueApp.fetch, port: rescuePort }, (info) => {
			logger.warn(
				{ port: info.port, bootError: classified.code },
				"ai-workbench listening in RESCUE MODE",
			);
		});
		// Keep main resolved; rescue mode runs until SIGTERM (operator
		// fix → /setup/restart → graceful shutdown → container restart).
		return;
	}
	const jobs = await buildJobStore({
		controlPlane: config.controlPlane,
		astraTables,
	});
	const drivers = buildVectorStoreDriverRegistry({ secrets });
	const embedders = makeEmbedderFactory({ secrets });
	const auth = await buildAuthResolver(config.auth, { store, secrets });
	assertSafeAuthDeployment(config);
	warnOnOpenMcpAuth(config);

	const login = await buildLoginOptions(config.auth, secrets, {
		publicOrigin: config.runtime.publicOrigin,
		trustProxyHeaders: config.runtime.trustProxyHeaders,
	});

	if (uiDir) {
		logger.info({ uiDir }, "ui enabled");
	} else {
		logger.info(
			"ui disabled — no dist found and runtime.uiDir not set; set runtime.uiDir or UI_DIR to serve the web UI from the runtime",
		);
	}

	// Aborted at the start of graceful shutdown so long-lived SSE streams
	// (job events) end promptly rather than holding the connection open
	// past `server.close()`'s drain window.
	const shutdownController = new AbortController();
	const readiness = {
		draining: false,
		shutdownSignal: shutdownController.signal,
	};
	const replicaId = config.runtime.replicaId ?? generateReplicaId();

	// In-process bound on concurrent ingest workers. Shared between the
	// route handler (POST .../ingest?async=true) and the orphan-sweeper
	// resume path so a single replica enforces a coherent cap. Default
	// 4; lift via `runtime.maxConcurrentIngestJobs`.
	const ingestSemaphore = new IngestSemaphore(
		config.runtime.maxConcurrentIngestJobs,
	);
	logger.info(
		{ capacity: config.runtime.maxConcurrentIngestJobs },
		"ingest concurrency cap configured",
	);

	const chatService = await buildChatService({
		config: config.chat ?? null,
		secrets,
	});
	if (chatService) {
		logger.info({ model: chatService.modelId }, "chat service initialized");
	} else {
		logger.info(
			"chat service not configured — POST /agents/{a}/conversations/{c}/messages will return 503 chat_disabled. Paste an OpenRouter key at /settings (default `chat.tokenRef: env:OPENROUTER_API_KEY`), select `chat.provider: ollama` for a local/offline model, attach a per-agent LLM service, or set `chat.enabled: false` in workbench.yaml to silence intentionally.",
		);
	}

	const telemetry = buildTelemetryEmitter({
		config: config.runtime.telemetry,
		version: VERSION,
	});

	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		embedders,
		environment: config.runtime.environment,
		publicOrigin: config.runtime.publicOrigin,
		trustProxyHeaders: config.runtime.trustProxyHeaders,
		csrfOriginCheck: config.runtime.csrfOriginCheck,
		jobs,
		ingestSemaphore,
		ui,
		login,
		readiness,
		astraCli,
		chatService,
		chatConfig: config.chat ?? null,
		mcpConfig: config.mcp,
		requestIdHeader: config.runtime.requestIdHeader,
		rateLimit: {
			enabled: config.runtime.rateLimit.enabled,
			capacity: config.runtime.rateLimit.capacity,
			windowMs: config.runtime.rateLimit.windowMs,
			trustProxyHeaders: config.runtime.trustProxyHeaders,
		},
		replicaId,
		authConfig: config.auth,
		triggerRestart: () => triggerRespawnAndShutdown(logger),
		telemetry,
	});

	// Cross-replica orphan-sweeper. Off by default — clustered
	// deployments opt in via `controlPlane.jobsResume.enabled` so the
	// single-replica reference deployment doesn't pay for it. When on,
	// reclaimed orphans whose kind has a registered resume callback and
	// that carry a persisted `inputSnapshot` are replayed; orphans of an
	// unregistered kind (or with no snapshot) fall back to mark-failed.
	//
	// `ingest` is the only resumable kind today: its snapshot is the
	// original IngestInput, replayed through `runKbIngestJob` (chunk IDs
	// are deterministic, so re-upsert is idempotent). Future resumable
	// kinds register here too.
	const resumes = new ResumeRegistry().register(
		"ingest",
		({ workspaceId, jobId, replicaId: rid, snapshot }) => {
			void runBounded(ingestSemaphore, () =>
				runKbIngestJob({
					deps: { store, drivers, embedders, jobs },
					workspaceId,
					jobId,
					replicaId: rid,
					// The `ingest` kind's snapshot is an IngestInputSnapshot,
					// structurally an IngestInput. The registry is
					// kind-agnostic (snapshot is an opaque JSON blob); this
					// callback owns the per-kind shape.
					input: snapshot as unknown as IngestInputSnapshot,
				}),
			);
		},
	);
	const sweeperCfg = config.controlPlane.jobsResume;
	const sweeper =
		sweeperCfg?.enabled === true
			? new JobOrphanSweeper({
					jobs,
					replicaId,
					graceMs: sweeperCfg.graceMs,
					intervalMs: sweeperCfg.intervalMs,
					resumes,
				})
			: null;
	if (sweeper) {
		sweeper.start();
		logger.info(
			{
				replicaId,
				graceMs: sweeperCfg?.graceMs,
				intervalMs: sweeperCfg?.intervalMs,
			},
			"job orphan sweeper enabled",
		);
	}

	// Opt-in one-shot orphan reconciliation (astra only). Sweeps
	// dependents stranded by a partial cross-partition cascade under the
	// legacy parent-row-first delete path; best-effort, never blocks
	// startup. New orphans don't occur under the children-first
	// deleteWorkspace, so this stays off by default.
	if (
		config.controlPlane.driver === "astra" &&
		config.controlPlane.reconcileOrphansOnStart &&
		store.reconcileOrphans
	) {
		try {
			const report = await store.reconcileOrphans();
			logger.info(
				{
					workspaces: report.workspaces,
					partialFailures: report.partialFailures,
				},
				"reconcileOrphansOnStart swept orphaned workspace dependents",
			);
		} catch (err) {
			logger.warn(
				{ err: err instanceof Error ? err.message : String(err) },
				"reconcileOrphansOnStart failed; continuing startup",
			);
		}
	}

	const port = config.runtime.port;
	const server = serve({ fetch: app.fetch, port }, async (info) => {
		const workspaces = await store.listWorkspaces();
		logger.info(
			{
				port: info.port,
				environment: config.runtime.environment,
				controlPlane: config.controlPlane.driver,
				authMode: config.auth.mode,
				anonymousPolicy: config.auth.anonymousPolicy,
				ui: ui !== null,
				workspaces: workspaces.length,
			},
			"ai-workbench listening",
		);
		telemetry.emit("runtime_start", {
			controlPlane: config.controlPlane.driver,
			authMode: config.auth.mode,
			environment: config.runtime.environment,
			hasChat: chatService !== null,
			chatProvider: chatService?.providerId ?? null,
		});
	});

	// Graceful shutdown: stop accepting new connections, wait for
	// in-flight requests to finish (up to SHUTDOWN_TIMEOUT_MS), then
	// close the control plane and exit. A second signal short-circuits
	// straight to exit so operators can force-kill a stuck process.
	const SHUTDOWN_TIMEOUT_MS = 15_000;
	let shuttingDown = false;
	const shutdown = (signal: string) => () => {
		if (shuttingDown) {
			logger.warn({ signal }, "second shutdown signal — forcing exit");
			process.exit(1);
			return;
		}
		shuttingDown = true;
		readiness.draining = true;
		// End in-flight job-events SSE streams now so they don't hold their
		// connections open through the drain window (clients reconnect + resume).
		shutdownController.abort();
		logger.info(
			{ signal, timeoutMs: SHUTDOWN_TIMEOUT_MS },
			"shutting down — /readyz now returns 503, draining in-flight requests",
		);

		const forceKill = setTimeout(() => {
			logger.error(
				{ signal, timeoutMs: SHUTDOWN_TIMEOUT_MS },
				"in-flight requests did not drain in time — forcing exit",
			);
			process.exit(1);
		}, SHUTDOWN_TIMEOUT_MS);
		forceKill.unref();

		// Stop the orphan-sweeper before draining the server so its
		// next tick doesn't fire mid-shutdown.
		sweeper?.stop();
		server.close(async (err) => {
			if (err) {
				logger.error({ err: err.message }, "server.close failed");
			}
			try {
				await store.close?.();
			} catch (closeErr) {
				logger.error(
					{ err: closeErr instanceof Error ? closeErr.message : "unknown" },
					"control-plane close failed",
				);
			}
			// Stop the cross-replica job-subscriber poller (a no-op for
			// memory/file backends that don't implement `stop`). The
			// method is now declared optional on `JobStore` itself —
			// backends with timers (Astra) opt in by implementing it,
			// the simpler backends omit it.
			try {
				await jobs.stop?.();
			} catch (stopErr) {
				logger.error(
					{ err: stopErr instanceof Error ? stopErr.message : "unknown" },
					"job store stop failed",
				);
			}
			// Flush in-flight spans before exit. No-op when tracing is
			// disabled.
			try {
				await otel?.shutdown();
			} catch (otelErr) {
				logger.error(
					{ err: otelErr instanceof Error ? otelErr.message : "unknown" },
					"otel shutdown failed",
				);
			}
			clearTimeout(forceKill);
			process.exit(err ? 1 : 0);
		});
	};
	process.on("SIGINT", shutdown("SIGINT"));
	process.on("SIGTERM", shutdown("SIGTERM"));
}

/**
 * Warn when MCP is enabled but auth is in its default open state.
 *
 * `auth.mode: disabled` (the dev default) means any caller who
 * discovers the MCP URL gets unrestricted access to every workspace.
 * This is fine on a loopback dev runtime; it is dangerous the moment
 * the port is forwarded, tunnelled, or deployed anywhere reachable
 * from outside the developer's machine.
 *
 * We log WARN rather than refusing to start so existing quick-start
 * configs keep working — but the message is loud enough that it shows
 * up in the terminal when the developer enables MCP for the first time.
 */
/**
 * Drive the runtime's reset path on `/setup/restart`. In container
 * deployments (PID 1), the orchestrator brings us back — just exit.
 * In dev / non-orchestrated modes, spawn a detached child first so
 * the runtime actually comes back; without this, SIGTERM kills the
 * process and `/readyz` polling loops forever.
 */
function triggerRespawnAndShutdown(log: {
	info: (obj: Record<string, unknown>, msg: string) => void;
	warn: (obj: Record<string, unknown>, msg: string) => void;
}): void {
	const plan = planRespawn({ pid: process.pid, containerEnv: process.env });
	log.info({ mode: plan.mode, reason: plan.reason }, "setup/restart triggered");
	if (plan.mode === "spawn") {
		try {
			const child = executeRespawn({
				execPath: process.execPath,
				execArgv: process.execArgv,
				argv: process.argv,
				cwd: process.cwd(),
			});
			log.info(
				{ childPid: child.pid ?? null },
				"spawned detached successor process; current process will now drain and exit",
			);
		} catch (err: unknown) {
			log.warn(
				{ err: err instanceof Error ? err.message : String(err) },
				"self-respawn failed; falling back to bare SIGTERM (operator must restart by hand)",
			);
		}
	}
	process.kill(process.pid, "SIGTERM");
}

function warnOnOpenMcpAuth(config: {
	readonly mcp: { readonly enabled: boolean };
	readonly auth: {
		readonly mode: string;
		readonly anonymousPolicy: string;
	};
}): void {
	if (!config.mcp.enabled) {
		return;
	}
	if (
		config.auth.mode !== "disabled" &&
		config.auth.anonymousPolicy === "reject"
	) {
		return;
	}
	logger.warn(
		{
			authMode: config.auth.mode,
			anonymousPolicy: config.auth.anonymousPolicy,
			mcpPath: "/api/v1/workspaces/{workspaceId}/mcp",
		},
		"MCP is enabled with open auth — any caller who knows the workspace URL has unrestricted MCP access; " +
			"set auth.mode to apiKey/oidc/any with anonymousPolicy: reject and mint a workspace API key per agent before exposing this runtime",
	);
}

async function buildLoginOptions(
	authCfg: AuthConfig,
	secrets: SecretResolver,
	runtime: {
		readonly publicOrigin: string | null;
		readonly trustProxyHeaders: boolean;
	},
): Promise<AppLoginOptions | null> {
	const clientCfg = authCfg.oidc?.client;
	if (!authCfg.oidc || !clientCfg) {
		return {
			authConfig: authCfg,
			endpoints: null,
			clientSecret: null,
			cookie: null,
			pending: null,
			publicOrigin: runtime.publicOrigin,
			trustProxyHeaders: runtime.trustProxyHeaders,
		};
	}

	// One-time network fetch at boot. Login + verifier share the
	// same discovery doc — this currently does it twice (once here,
	// once inside the verifier factory) to keep the modules
	// decoupled; if it becomes a cold-start issue we'll cache.
	const endpoints = await fetchOidcEndpoints({ issuer: authCfg.oidc.issuer });

	const clientSecret = clientCfg.clientSecretRef
		? await secrets.resolve(clientCfg.clientSecretRef)
		: null;

	let sessionKey: Buffer;
	if (clientCfg.sessionSecretRef) {
		const raw = await secrets.resolve(clientCfg.sessionSecretRef);
		sessionKey = Buffer.from(raw, "utf8");
		if (sessionKey.length < 32) {
			throw new Error(
				"auth.oidc.client.sessionSecretRef must resolve to >=32 bytes of entropy",
			);
		}
	} else {
		// Reaching here means `assertSafeAuthDeployment` already
		// confirmed we're on a memory control plane (the durable-store
		// gate would have refused to start otherwise). Ephemeral key is
		// fine for an in-memory dev runtime; sessions die with the
		// process anyway.
		sessionKey = generateSessionKey();
		logger.warn(
			"auth.oidc.client.sessionSecretRef is not set — generated an ephemeral session key for the in-memory control plane. All browser sessions invalidate on restart; this is rejected automatically on file/astra control planes.",
		);
	}
	const cookie = makeCookieSigner(sessionKey);
	const pending = new MemoryPendingLoginStore();

	logger.info(
		{
			clientId: clientCfg.clientId,
			redirectPath: clientCfg.redirectPath,
			hasSecret: clientSecret !== null,
			hasPersistentKey: clientCfg.sessionSecretRef !== null,
			publicOrigin: runtime.publicOrigin,
			trustProxyHeaders: runtime.trustProxyHeaders,
		},
		"oidc browser-login enabled",
	);

	return {
		authConfig: authCfg,
		endpoints,
		clientSecret,
		cookie,
		pending,
		publicOrigin: runtime.publicOrigin,
		trustProxyHeaders: runtime.trustProxyHeaders,
	};
}

main().catch((err: unknown) => {
	logger.error({ err }, "startup failed");
	process.exit(1);
});
