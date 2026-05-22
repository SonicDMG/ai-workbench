/**
 * First-run credentials step.
 *
 * Collects the small allow-list the runtime needs to talk to Astra +
 * HuggingFace, POSTs them to `/setup/env` (the wizard-managed
 * dotenv file), triggers `/setup/restart`, and polls `/readyz` until
 * the runtime comes back up. Once green, hands control back to the
 * wizard's "kind" step.
 *
 * The component is intentionally framework-light: all the state
 * lives here. It assumes the wizard parent has already determined
 * the credentials step is needed (`hasAstraCreds === false` AND
 * `managedEnv.writable === true`).
 */
import { CheckCircle2, KeyRound, Loader2, RefreshCw } from "lucide-react";
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
import { api } from "@/lib/api";
import type { AstraCliInfo, ManagedEnvKey } from "@/lib/schemas";

interface CredentialsStepProps {
	readonly astraCli: AstraCliInfo | null | undefined;
	readonly onSkip: () => void;
	readonly onComplete: () => void;
	readonly managedEnvPath: string;
}

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

export function CredentialsStep({
	astraCli,
	onSkip,
	onComplete,
	managedEnvPath,
}: CredentialsStepProps) {
	const [endpoint, setEndpoint] = useState<string>("");
	const [token, setToken] = useState<string>("");
	const [hfKey, setHfKey] = useState<string>("");
	const [phase, setPhase] = useState<Phase>("form");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	const detectedHint =
		astraCli?.detected === true
			? `Astra CLI detected database "${astraCli.database.name}"; you can skip this step and the runtime will use those values at boot.`
			: null;

	const submit = async () => {
		setErrorMessage(null);
		const values: Partial<Record<ManagedEnvKey, string>> = {};
		if (endpoint.trim()) values.ASTRA_DB_API_ENDPOINT = endpoint.trim();
		if (token.trim()) values.ASTRA_DB_APPLICATION_TOKEN = token.trim();
		if (hfKey.trim()) values.HUGGINGFACE_API_KEY = hfKey.trim();
		if (Object.keys(values).length === 0) {
			setErrorMessage(
				"Provide at least one credential, or click Skip to use mock workspaces only.",
			);
			return;
		}
		setPhase("writing");
		try {
			await api.postSetupEnv(values);
		} catch (err: unknown) {
			setErrorMessage(err instanceof Error ? err.message : String(err));
			setPhase("error");
			return;
		}
		setPhase("restarting");
		try {
			await api.postSetupRestart();
		} catch (err: unknown) {
			// Restart endpoint might 503 if the runtime didn't register a
			// hook — surface the actionable hint and bail.
			setErrorMessage(err instanceof Error ? err.message : String(err));
			toast.error(
				"Restart endpoint unavailable. Run `docker compose restart workbench`, then reload this page.",
			);
			setPhase("error");
			return;
		}
		setPhase("waiting");
		const back = await pollReadyz(READYZ_POLL_TIMEOUT_MS);
		if (!back) {
			setErrorMessage(
				"Runtime didn't come back within 60s. Run `docker compose restart workbench` manually, then reload this page.",
			);
			setPhase("error");
			return;
		}
		setPhase("ready");
		toast.success("Credentials saved and runtime restarted.");
		onComplete();
	};

	const busy =
		phase === "writing" || phase === "restarting" || phase === "waiting";

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-2">
					<KeyRound
						className="h-5 w-5 text-[var(--color-brand-600)]"
						aria-hidden="true"
					/>
					<CardTitle>Connect credentials</CardTitle>
				</div>
				<CardDescription>
					Persist Astra and HuggingFace credentials so the runtime can reach
					them across restarts. The wizard writes them to{" "}
					<code className="font-mono">{managedEnvPath}</code> (mode 0600, backed
					by the workbench-data volume) and restarts the runtime so the new
					values take effect.
				</CardDescription>
				{detectedHint ? (
					<div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200">
						{detectedHint}
					</div>
				) : null}
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="setup-astra-endpoint">
						Astra DB API endpoint{" "}
						<span className="text-xs text-slate-500">(optional)</span>
					</Label>
					<Input
						id="setup-astra-endpoint"
						placeholder="https://<db-id>-<region>.apps.astra.datastax.com"
						value={endpoint}
						onChange={(e) => setEndpoint(e.target.value)}
						disabled={busy}
						autoComplete="off"
						spellCheck={false}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="setup-astra-token">
						Astra DB application token{" "}
						<span className="text-xs text-slate-500">(optional)</span>
					</Label>
					<Input
						id="setup-astra-token"
						type="password"
						placeholder="AstraCS:…"
						value={token}
						onChange={(e) => setToken(e.target.value)}
						disabled={busy}
						autoComplete="off"
						spellCheck={false}
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="setup-hf-key">
						HuggingFace API key{" "}
						<span className="text-xs text-slate-500">
							(optional — needed for Chat with Bobby)
						</span>
					</Label>
					<Input
						id="setup-hf-key"
						type="password"
						placeholder="hf_…"
						value={hfKey}
						onChange={(e) => setHfKey(e.target.value)}
						disabled={busy}
						autoComplete="off"
						spellCheck={false}
					/>
				</div>

				{errorMessage ? (
					<div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
						{errorMessage}
					</div>
				) : null}

				{phase === "restarting" || phase === "waiting" ? (
					<div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
						<Loader2 className="h-4 w-4 animate-spin" />
						{phase === "restarting"
							? "Restarting runtime…"
							: "Waiting for runtime to come back up…"}
					</div>
				) : null}

				{phase === "ready" ? (
					<div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-300">
						<CheckCircle2 className="h-4 w-4" /> Credentials saved.
					</div>
				) : null}
			</CardContent>
			<div className="flex items-center justify-between gap-2 p-5 pt-0">
				<Button variant="ghost" onClick={onSkip} disabled={busy}>
					Skip for now
				</Button>
				<Button variant="brand" onClick={submit} disabled={busy}>
					{busy ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<RefreshCw className="h-4 w-4" />
					)}
					Save and restart
				</Button>
			</div>
		</Card>
	);
}
