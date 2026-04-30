/**
 * Single-call tool dispatcher — the unified primitive that the
 * agent tool-call loop and the MCP façade both delegate to whenever
 * they need to run one workspace tool.
 *
 * What's shared:
 *   - Argument parsing (string-encoded JSON the model emits, or a
 *     pre-parsed object an MCP client passes in).
 *   - Validation error → string formatting.
 *   - "Unknown tool" recovery (so the model can self-correct without a
 *     thrown exception bubbling up).
 *
 * What stays per-surface:
 *   - The outer iteration loop (agent dispatch interleaves persistence
 *     and streaming; MCP is RPC-driven by the SDK).
 *   - The wire envelope (agent yields a string for the next `tool`
 *     turn; MCP wraps it in `{ content: [{type:"text",text}] }`).
 */

import type { ToolCall } from "../types.js";
import {
	type AgentTool,
	type AgentToolDeps,
	DEFAULT_AGENT_TOOLS,
} from "./registry.js";

/**
 * Run one tool call against the default workspace toolset. Returns
 * the string the model should see in its next `tool` turn.
 *
 * Defensive on every input: malformed JSON arguments, unknown tool
 * names, and tool exceptions all collapse to an `Error: ...` string
 * the model can read and recover from.
 */
export async function executeWorkspaceTool(
	call: ToolCall,
	deps: AgentToolDeps,
): Promise<string> {
	const tool = resolveDefaultTool(call.name);
	if (!tool) {
		return `Error: tool '${call.name}' is not available. Try one of: ${DEFAULT_AGENT_TOOLS.map((t) => t.definition.name).join(", ")}.`;
	}
	let parsed: unknown;
	try {
		parsed = call.arguments.length === 0 ? {} : JSON.parse(call.arguments);
	} catch (err) {
		return `Error: tool arguments were not valid JSON (${err instanceof Error ? err.message : String(err)}).`;
	}
	try {
		return await tool.execute(parsed, deps);
	} catch (err) {
		deps.logger?.warn?.(
			{ err, tool: call.name },
			"agent tool threw — surfacing as a tool error",
		);
		return `Error: tool '${call.name}' failed — ${err instanceof Error ? err.message : String(err)}.`;
	}
}

/**
 * Variant for callers (e.g. MCP) that already have parsed args. Skips
 * the JSON.parse step but otherwise applies the same recovery.
 */
export async function executeWorkspaceToolByName(
	name: string,
	parsedArgs: unknown,
	deps: AgentToolDeps,
): Promise<string> {
	const tool = resolveDefaultTool(name);
	if (!tool) {
		return `Error: tool '${name}' is not available.`;
	}
	try {
		return await tool.execute(parsedArgs, deps);
	} catch (err) {
		deps.logger?.warn?.(
			{ err, tool: name },
			"agent tool threw — surfacing as a tool error",
		);
		return `Error: tool '${name}' failed — ${err instanceof Error ? err.message : String(err)}.`;
	}
}

function resolveDefaultTool(name: string): AgentTool | null {
	return DEFAULT_AGENT_TOOLS.find((t) => t.definition.name === name) ?? null;
}
