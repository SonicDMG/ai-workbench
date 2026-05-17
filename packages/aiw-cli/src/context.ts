/**
 * Bundle a profile resolution + HTTP context for every command.
 *
 * Commands import {@link loadContext} which reads the config file,
 * applies flag/env overrides, and returns a ready-to-use
 * {@link RequestContext}. Keeps the per-command boilerplate to one
 * line.
 */
import {
	defaultConfigLocation,
	type ResolvedProfile,
	readConfig,
	resolveProfile,
} from "./config.js";
import type { RequestContext } from "./http.js";
import { type OutputFormat, parseOutputFormat } from "./output.js";

export interface CommonArgs {
	readonly profile?: string;
	readonly url?: string;
	readonly output?: string;
}

export interface LoadedContext {
	readonly request: RequestContext;
	readonly resolved: ResolvedProfile;
	readonly output: OutputFormat;
}

export async function loadContext(args: CommonArgs): Promise<LoadedContext> {
	const config = await readConfig(defaultConfigLocation());
	const resolved = resolveProfile(config, {
		profileName: args.profile,
		url: args.url,
	});
	const output = parseOutputFormat(args.output);
	return {
		request: { profile: resolved.profile },
		resolved,
		output,
	};
}
