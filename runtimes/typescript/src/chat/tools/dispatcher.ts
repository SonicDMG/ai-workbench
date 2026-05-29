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
 *   - Guardrails that apply to EVERY tool call regardless of source
 *     (built-in, native, Astra, remote-MCP): a hard per-call timeout
 *     and an output-size cap on the string returned to the model.
 *
 * What stays per-surface:
 *   - The outer iteration loop (agent dispatch interleaves persistence
 *     and streaming; MCP is RPC-driven by the SDK).
 *   - The wire envelope (agent yields a string for the next `tool`
 *     turn; MCP wraps it in `{ content: [{type:"text",text}] }`).
 *   - Audit emission. `executeWorkspaceTool` returns the {@link
 *     ToolInvokeOutcome} so the caller (the agent dispatch path) can
 *     forward it to an `onToolInvoke` hook without this module having to
 *     know about the audit layer — mirrors the `mcp/server.ts` seam.
 */

import type { ToolCall } from "../types.js";
import {
	type AgentTool,
	type AgentToolDeps,
	type AgentToolset,
	DEFAULT_AGENT_TOOLS,
} from "./registry.js";

/**
 * Default hard timeout for a single tool call, in milliseconds. A
 * confused remote-MCP server or a hung native fetch must not be able to
 * wedge the agent loop forever. A3 owns the forthcoming `chat.tools`
 * config block that will let deployments tune this; until that lands the
 * dispatcher falls back to this constant.
 */
export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;

/**
 * Default cap on the size (in characters) of the tool-result string the
 * model sees. The built-in tools already truncate their previews; this
 * is the backstop for native / remote-MCP tools that can return an
 * arbitrarily large body and blow up the next prompt. Truncation is
 * lossy by design — the marker tells the model the result was clipped
 * so it can narrow its next call rather than assume it saw everything.
 */
export const DEFAULT_TOOL_OUTPUT_CAP_CHARS = 32_000;

/** Appended to a clipped tool result so the model knows it's partial. */
const TRUNCATION_MARKER = "\n…[tool result truncated]";

/**
 * Outcome of a single tool invocation, mirroring the audit module's
 * {@link AuditOutcome} discriminant and the `mcp/server.ts`
 * `McpToolInvocation` shape:
 *
 *   - `success` — the tool ran and returned a result.
 *   - `failure` — the tool threw, timed out, or its arguments were
 *                 malformed JSON. The model still gets an `Error: …`
 *                 string to recover from; the audit row carries
 *                 `outcome: "failure"` with a short `reason`.
 *   - `denied`  — the tool is not on this agent's allow-list (A1). The
 *                 model gets an "not available to this agent" string;
 *                 the audit row carries `outcome: "denied"`.
 */
export interface ToolInvokeOutcome {
	readonly outcome: "success" | "failure" | "denied";
	readonly reason?: string;
}

/**
 * Payload handed to the optional `onToolInvoke` hook the agent dispatch
 * path threads down from the route layer. The route maps it to a
 * `tool.invoke` audit event. Carries the tool name + {@link
 * ToolInvokeOutcome} but NEVER the arguments — secrets can live in args
 * and must not reach the audit log (same rule as `mcp/server.ts`'s
 * `McpToolInvocation`).
 */
export interface ToolInvokeInfo extends ToolInvokeOutcome {
	readonly toolName: string;
}

/**
 * Optional hook fired once per tool call in the agent loop. Kept as a
 * plain callback so the chat layer never imports the audit module —
 * the route layer supplies a closure that emits `tool.invoke`. Mirrors
 * the `onToolInvoke` seam in `mcp/server.ts`.
 */
export type OnToolInvoke = (info: ToolInvokeInfo) => void;

/**
 * Result of running one tool call: the string the model should see in
 * its next `tool` turn, plus the {@link ToolInvokeOutcome} the caller
 * forwards to its audit hook. Deliberately does NOT carry the tool
 * arguments — secrets can live in args and must never reach the audit
 * envelope (same rule as `mcp/server.ts`).
 */
export interface ToolExecutionResult extends ToolInvokeOutcome {
	readonly resultText: string;
}

/**
 * Clip a tool result to `cap` characters, appending a clear marker when
 * it overflows so the model knows the body is partial. The marker is
 * counted toward the budget so the returned string never exceeds `cap`.
 */
function capToolOutput(text: string, cap: number): string {
	if (text.length <= cap) return text;
	const room = Math.max(0, cap - TRUNCATION_MARKER.length);
	return text.slice(0, room) + TRUNCATION_MARKER;
}

/**
 * Run `tool.execute` with a hard timeout. On timeout, resolves to an
 * `Error: …` string (does NOT throw) so the agent loop surfaces it as a
 * recoverable `tool` turn exactly like any other tool error. The
 * underlying tool promise may still be running — the runtime can't
 * cancel an arbitrary tool body — but the loop no longer waits on it.
 *
 * Returns a discriminated result so the caller can stamp the audit
 * outcome without re-parsing the string.
 */
async function executeWithTimeout(
	tool: AgentTool,
	call: ToolCall,
	parsedArgs: unknown,
	deps: AgentToolDeps,
	timeoutMs: number,
): Promise<ToolExecutionResult> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<{ readonly timedOut: true }>((resolveTimeout) => {
		timer = setTimeout(() => resolveTimeout({ timedOut: true }), timeoutMs);
	});
	try {
		const raced = await Promise.race([
			tool.execute(parsedArgs, deps).then((resultText) => ({ resultText })),
			timeout,
		]);
		if ("timedOut" in raced) {
			const reason = `timed out after ${timeoutMs}ms`;
			deps.logger?.warn?.(
				{ tool: call.name, timeoutMs },
				"agent tool timed out — surfacing as a tool error",
			);
			return {
				resultText: `Error: tool '${call.name}' timed out after ${timeoutMs}ms.`,
				outcome: "failure",
				reason,
			};
		}
		return { resultText: raced.resultText, outcome: "success" };
	} catch (err) {
		deps.logger?.warn?.(
			{ err, tool: call.name },
			"agent tool threw — surfacing as a tool error",
		);
		const message = err instanceof Error ? err.message : String(err);
		return {
			resultText: `Error: tool '${call.name}' failed — ${message}.`,
			outcome: "failure",
			reason: message,
		};
	} finally {
		if (timer) clearTimeout(timer);
	}
}

/**
 * Run one tool call against an agent's resolved toolset. Returns the
 * string the model should see in its next `tool` turn plus the
 * {@link ToolInvokeOutcome} the caller forwards to its audit hook.
 *
 * Defensive on every input: an unknown / disallowed tool name (the A1
 * allow-list gate), malformed JSON arguments, a timed-out tool, and a
 * thrown tool all collapse to an `Error: …` string the model can read
 * and recover from. Every result string is capped at the configured
 * output size so a native / remote tool can't blow up the next prompt.
 */
export async function executeWorkspaceTool(
	call: ToolCall,
	toolset: AgentToolset,
	deps: AgentToolDeps,
): Promise<ToolExecutionResult> {
	const tool = toolset.resolve(call.name);
	if (!tool) {
		const available = toolset.tools.map((t) => t.definition.name).join(", ");
		const resultText = `Error: tool '${call.name}' is not available to this agent.${
			available
				? ` Available tools: ${available}.`
				: " This agent has no tools enabled."
		}`;
		// Allow-list rejection (A1) → audited as `denied`, distinct from a
		// tool that ran and failed.
		return {
			resultText: capToolOutput(resultText, DEFAULT_TOOL_OUTPUT_CAP_CHARS),
			outcome: "denied",
			reason: "tool not available to this agent",
		};
	}
	let parsed: unknown;
	try {
		parsed = call.arguments.length === 0 ? {} : JSON.parse(call.arguments);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return {
			resultText: capToolOutput(
				`Error: tool arguments were not valid JSON (${message}).`,
				DEFAULT_TOOL_OUTPUT_CAP_CHARS,
			),
			outcome: "failure",
			reason: "invalid tool arguments JSON",
		};
	}
	const ran = await executeWithTimeout(
		tool,
		call,
		parsed,
		deps,
		DEFAULT_TOOL_TIMEOUT_MS,
	);
	return {
		...ran,
		resultText: capToolOutput(ran.resultText, DEFAULT_TOOL_OUTPUT_CAP_CHARS),
	};
}

/**
 * Variant for callers (e.g. MCP) that already have parsed args. Skips
 * the JSON.parse step but otherwise applies the same recovery, timeout,
 * and output-size guardrails. Returns the plain result string — the MCP
 * façade does its own audit via the SDK `registerTool` wrap, so this
 * variant doesn't surface the structured outcome.
 */
export async function executeWorkspaceToolByName(
	name: string,
	parsedArgs: unknown,
	deps: AgentToolDeps,
): Promise<string> {
	const tool = resolveDefaultTool(name);
	if (!tool) {
		return capToolOutput(
			`Error: tool '${name}' is not available.`,
			DEFAULT_TOOL_OUTPUT_CAP_CHARS,
		);
	}
	const ran = await executeWithTimeout(
		tool,
		{ id: "", name, arguments: "" },
		parsedArgs,
		deps,
		DEFAULT_TOOL_TIMEOUT_MS,
	);
	return capToolOutput(ran.resultText, DEFAULT_TOOL_OUTPUT_CAP_CHARS);
}

function resolveDefaultTool(name: string): AgentTool | null {
	return DEFAULT_AGENT_TOOLS.find((t) => t.definition.name === name) ?? null;
}
