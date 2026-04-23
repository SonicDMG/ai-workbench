import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { buildAuthResolver } from "./auth/factory.js";
import { loadDotEnv } from "./config/env-file.js";
import { loadConfig, resolveConfigPath } from "./config/loader.js";
import { storeFromConfig } from "./control-plane/factory.js";
import { buildVectorStoreDriverRegistry } from "./drivers/factory.js";
import { logger } from "./lib/logger.js";
import { EnvSecretProvider } from "./secrets/env.js";
import { FileSecretProvider } from "./secrets/file.js";
import { SecretResolver } from "./secrets/provider.js";

async function main(): Promise<void> {
	// Load .env (repo-root by default) before anything reads `process.env`.
	const envFile = loadDotEnv();
	if (envFile.path) {
		logger.info(
			{ envFile: envFile.path, source: envFile.source },
			"loaded env file",
		);
	}

	const configPath = resolveConfigPath();
	logger.info({ configPath }, "loading config");

	const config = await loadConfig(configPath);

	const secrets = new SecretResolver({
		env: new EnvSecretProvider(),
		file: new FileSecretProvider(),
	});

	const store = await storeFromConfig(config, secrets);
	const drivers = buildVectorStoreDriverRegistry({ secrets });
	const auth = buildAuthResolver(config.auth, { store });

	const app = createApp({
		store,
		drivers,
		secrets,
		auth,
		requestIdHeader: config.runtime.requestIdHeader,
	});

	const port = config.runtime.port;
	serve({ fetch: app.fetch, port }, async (info) => {
		const workspaces = await store.listWorkspaces();
		logger.info(
			{
				port: info.port,
				controlPlane: config.controlPlane.driver,
				authMode: config.auth.mode,
				anonymousPolicy: config.auth.anonymousPolicy,
				workspaces: workspaces.length,
			},
			"ai-workbench listening",
		);
	});

	const shutdown = (signal: string) => async () => {
		logger.info({ signal }, "shutting down");
		await store.close?.();
		process.exit(0);
	};
	process.on("SIGINT", shutdown("SIGINT"));
	process.on("SIGTERM", shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
	logger.error({ err }, "startup failed");
	process.exit(1);
});
