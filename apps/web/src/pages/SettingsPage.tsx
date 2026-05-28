/**
 * Runtime settings page (`/settings`).
 *
 * Holds runtime-wide configuration that doesn't belong on a
 * per-workspace settings page. Today: the credentials editor for
 * Astra and the chat provider key (OpenRouter, or a direct OpenAI
 * key), which previously could only be set during the first-run
 * onboarding wizard. The wizard runs once and then disappears; this
 * page is the post-setup escape hatch so operators can fix a missing
 * `OPENROUTER_API_KEY` (or rotate a key) without restarting the
 * container by hand.
 *
 * Backed by the same `/setup/env` + `/setup/restart` endpoints the
 * wizard already uses. The runtime's `setupAuthGate` was relaxed in
 * 0.2.1 so these endpoints accept post-setup updates when
 * `auth.mode: disabled` (the single-user dev posture); auth-enabled
 * deployments still need a bootstrap token.
 */
import { useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	CheckCircle2,
	Cog,
	KeyRound,
	Loader2,
	RefreshCw,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSetupStatus } from "@/hooks/useSetupStatus";
import { api, formatApiError } from "@/lib/api";
import type { ManagedEnvKey } from "@/lib/schemas";

type Phase = "form" | "writing" | "restarting" | "waiting" | "ready" | "error";

const READYZ_POLL_TIMEOUT_MS = 60_000;
const READYZ_POLL_INTERVAL_MS = 1_500;

async function pollReadyz(timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch("/readyz", {
				headers: { accept: "application/json" },
			});
			if (res.ok) return true;
		} catch {
			// Still down; loop.
		}
		await new Promise((r) => setTimeout(r, READYZ_POLL_INTERVAL_MS));
	}
	return false;
}

export function SettingsPage() {
	const { data: status } = useSetupStatus();
	const bootError = status?.bootError ?? null;
	return (
		<div className="space-y-6">
			<header className="flex items-center gap-3">
				<Cog className="h-6 w-6 text-slate-600 dark:text-slate-300" />
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Settings</h1>
					<p className="text-sm text-slate-500 dark:text-slate-400">
						Runtime-wide configuration. Per-workspace settings live on each
						workspace's own settings page.
					</p>
				</div>
			</header>
			{bootError ? <BootErrorBanner error={bootError} /> : null}
			{status && !bootError && !status.hasChatProvider ? (
				<div className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
					<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
					<div>
						<p className="font-medium">Chat is unconfigured.</p>
						<p className="mt-1 text-xs leading-relaxed">
							The runtime booted without a chat provider key, so agent message
							endpoints return <code>503 chat_disabled</code>. Set your
							OpenRouter (or OpenAI) key below and save — the runtime will
							restart and reconnect.
						</p>
					</div>
				</div>
			) : null}
			<CredentialsCard />
		</div>
	);
}

function BootErrorBanner({
	error,
}: {
	readonly error: { code: string; message: string };
}) {
	const hint = bootErrorHint(error.code);
	return (
		<div
			role="alert"
			className="flex items-start gap-3 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-100"
		>
			<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
			<div className="space-y-1">
				<p className="font-medium">Runtime is in rescue mode.</p>
				<p className="text-xs leading-relaxed">
					Control-plane initialization failed (<code>{error.code}</code>), so
					<code> /api/v1/*</code> is unavailable until you fix the credentials
					and restart. {hint}
				</p>
				<p className="font-mono text-[11px] leading-relaxed text-red-900/80 dark:text-red-100/80">
					{error.message}
				</p>
			</div>
		</div>
	);
}

function bootErrorHint(code: string): string {
	switch (code) {
		case "control_plane_dns_unresolvable":
			return "The Astra endpoint hostname didn't resolve — usually a typo in the URL or a wrong database id.";
		case "control_plane_unreachable":
			return "The Astra endpoint accepted the connection but the request timed out or was refused. Check the URL and your network.";
		case "control_plane_unauthorized":
			return "The Astra token was rejected. Mint a new one from the Astra console and paste it below.";
		case "control_plane_forbidden":
			return "The token doesn't have permission to access this database. Confirm the token + database pairing.";
		default:
			return "Update the credentials below and click Save & restart.";
	}
}

function CredentialsCard() {
	const { data: status } = useSetupStatus();
	const qc = useQueryClient();
	const [astraEndpoint, setAstraEndpoint] = useState("");
	const [astraToken, setAstraToken] = useState("");
	const [openrouterKey, setOpenrouterKey] = useState("");
	const [openaiKey, setOpenaiKey] = useState("");
	const [phase, setPhase] = useState<Phase>("form");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const writable = status?.managedEnv.writable ?? true;
	const managedPath = status?.managedEnv.path ?? "(unknown)";
	// Which credentials already resolve to a value in the runtime's
	// environment, so each field can confirm it's configured without
	// the value ever crossing the wire.
	const configured = new Set(status?.managedEnv.configuredKeys ?? []);

	async function save() {
		const values: Partial<Record<ManagedEnvKey, string>> = {};
		if (astraEndpoint.trim())
			values.ASTRA_DB_API_ENDPOINT = astraEndpoint.trim();
		if (astraToken.trim())
			values.ASTRA_DB_APPLICATION_TOKEN = astraToken.trim();
		if (openrouterKey.trim()) values.OPENROUTER_API_KEY = openrouterKey.trim();
		if (openaiKey.trim()) values.OPENAI_API_KEY = openaiKey.trim();
		if (Object.keys(values).length === 0) {
			toast.info("Nothing to save — fill at least one field.");
			return;
		}
		setErrorMessage(null);
		setPhase("writing");
		try {
			await api.postSetupEnv(values);
		} catch (err) {
			setErrorMessage(formatApiError(err));
			setPhase("error");
			return;
		}
		setPhase("restarting");
		try {
			await api.postSetupRestart();
		} catch (err) {
			setErrorMessage(formatApiError(err));
			setPhase("error");
			return;
		}
		setPhase("waiting");
		const ready = await pollReadyz(READYZ_POLL_TIMEOUT_MS);
		if (!ready) {
			setErrorMessage(
				`Runtime did not come back within ${Math.round(READYZ_POLL_TIMEOUT_MS / 1000)}s. Check container logs and retry.`,
			);
			setPhase("error");
			return;
		}
		setPhase("ready");
		toast.success("Credentials saved and runtime reconnected.");
		// Pull a fresh /setup-status so the page reflects the new
		// `hasChatProvider` / `hasAstraCreds` state, and clear inputs
		// so we don't keep sensitive material in DOM state.
		setAstraEndpoint("");
		setAstraToken("");
		setOpenrouterKey("");
		setOpenaiKey("");
		await qc.invalidateQueries({ queryKey: ["setup-status"] });
	}

	const submitting =
		phase === "writing" || phase === "restarting" || phase === "waiting";

	return (
		<Card>
			<CardHeader>
				<div className="flex items-start gap-3">
					<KeyRound className="mt-0.5 h-4 w-4 text-slate-600 dark:text-slate-300" />
					<div className="min-w-0">
						<CardTitle className="text-base">Runtime credentials</CardTitle>
						<CardDescription className="mt-1 leading-relaxed">
							Astra DB and your chat provider key (OpenRouter, or a direct
							OpenAI key) persist to the workbench-managed dotenv file at{" "}
							<code className="text-xs">{managedPath}</code> (mode 0600). Saving
							triggers a graceful runtime restart; the page reconnects when{" "}
							<code>/readyz</code> returns OK.
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{!writable ? (
					<div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
						<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
						<span>
							Managed env file is not writable from the runtime container. Mount
							a writable <code>WORKBENCH_DATA_DIR</code> (or set{" "}
							<code>WORKBENCH_MANAGED_ENV_FILE</code>) and reload.
						</span>
					</div>
				) : null}
				<div className="space-y-2">
					<FieldLabelRow
						htmlFor="astra-endpoint"
						configured={configured.has("ASTRA_DB_API_ENDPOINT")}
					>
						Astra DB API endpoint
					</FieldLabelRow>
					<Input
						id="astra-endpoint"
						type="url"
						placeholder="https://db-xxxx.apps.astra.datastax.com"
						autoComplete="off"
						value={astraEndpoint}
						onChange={(e) => setAstraEndpoint(e.target.value)}
						disabled={submitting || !writable}
					/>
				</div>
				<div className="space-y-2">
					<FieldLabelRow
						htmlFor="astra-token"
						configured={configured.has("ASTRA_DB_APPLICATION_TOKEN")}
					>
						Astra DB application token
					</FieldLabelRow>
					<Input
						id="astra-token"
						type="password"
						placeholder={
							configured.has("ASTRA_DB_APPLICATION_TOKEN")
								? "•••••••• (leave blank to keep current)"
								: "AstraCS:..."
						}
						autoComplete="off"
						value={astraToken}
						onChange={(e) => setAstraToken(e.target.value)}
						disabled={submitting || !writable}
					/>
				</div>
				<div className="space-y-2">
					<FieldLabelRow
						htmlFor="openrouter-key"
						configured={configured.has("OPENROUTER_API_KEY")}
					>
						OpenRouter API key
					</FieldLabelRow>
					<Input
						id="openrouter-key"
						type="password"
						placeholder={
							configured.has("OPENROUTER_API_KEY")
								? "•••••••• (leave blank to keep current)"
								: "sk-or-..."
						}
						autoComplete="off"
						value={openrouterKey}
						onChange={(e) => setOpenrouterKey(e.target.value)}
						disabled={submitting || !writable}
					/>
					<p className="text-xs text-slate-500 dark:text-slate-400">
						The runtime's default chat + embedding key (one key → 300+ models).
						Per-agent LLM services override this.
					</p>
				</div>
				<div className="space-y-2">
					<FieldLabelRow
						htmlFor="openai-key"
						configured={configured.has("OPENAI_API_KEY")}
					>
						OpenAI API key
					</FieldLabelRow>
					<Input
						id="openai-key"
						type="password"
						placeholder={
							configured.has("OPENAI_API_KEY")
								? "•••••••• (leave blank to keep current)"
								: "sk-..."
						}
						autoComplete="off"
						value={openaiKey}
						onChange={(e) => setOpenaiKey(e.target.value)}
						disabled={submitting || !writable}
					/>
					<p className="text-xs text-slate-500 dark:text-slate-400">
						Optional — direct/BYOK for services with{" "}
						<code>provider: openai</code> instead of routing through OpenRouter.
					</p>
				</div>
				<div className="flex items-center justify-between gap-3 pt-1">
					<PhaseHint phase={phase} errorMessage={errorMessage} />
					<Button
						onClick={() => void save()}
						disabled={submitting || !writable}
					>
						{submitting ? (
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
						) : (
							<RefreshCw className="mr-2 h-4 w-4" />
						)}
						Save & restart
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

/**
 * A field label with an optional green "Configured" affordance on the
 * right — confirms the credential already resolves to a value in the
 * runtime environment (the value itself never leaves the server).
 */
function FieldLabelRow({
	htmlFor,
	configured,
	children,
}: {
	readonly htmlFor: string;
	readonly configured: boolean;
	readonly children: React.ReactNode;
}) {
	return (
		<div className="flex items-center justify-between gap-2">
			<Label htmlFor={htmlFor}>{children}</Label>
			{configured ? (
				<span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
					<CheckCircle2 className="h-3.5 w-3.5" />
					Configured
				</span>
			) : null}
		</div>
	);
}

function PhaseHint({
	phase,
	errorMessage,
}: {
	readonly phase: Phase;
	readonly errorMessage: string | null;
}) {
	if (phase === "writing") {
		return <span className="text-xs text-slate-500">Writing managed env…</span>;
	}
	if (phase === "restarting") {
		return (
			<span className="text-xs text-slate-500">
				Restarting runtime — connection will drop briefly.
			</span>
		);
	}
	if (phase === "waiting") {
		return (
			<span className="text-xs text-slate-500">
				Waiting for /readyz to come back…
			</span>
		);
	}
	if (phase === "ready") {
		return (
			<span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
				<CheckCircle2 className="h-3.5 w-3.5" />
				Reconnected.
			</span>
		);
	}
	if (phase === "error") {
		return (
			<span className="text-xs text-red-700 dark:text-red-300">
				{errorMessage ?? "Failed."}
			</span>
		);
	}
	return null;
}
