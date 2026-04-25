import { AlertTriangle, CheckCircle2, PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTestConnection } from "@/hooks/useWorkspaces";
import { formatApiError } from "@/lib/api";
import type { TestConnectionResult } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/**
 * Button + inline result banner for
 * `POST /workspaces/{uid}/test-connection`. Stays collapsed until
 * the user clicks it; on success, shows a green confirmation; on
 * failure, shows the server's `details` so the user can act on it
 * (missing env var, malformed ref, etc.).
 */
export function TestConnectionPanel({ uid }: { uid: string }) {
	const probe = useTestConnection(uid);
	const result = probe.data;
	const runtimeError = probe.error ? formatApiError(probe.error) : null;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex items-center justify-between gap-3 flex-wrap">
				<div>
					<p className="text-sm font-medium text-slate-900">Connection probe</p>
					<p className="text-xs text-slate-500 leading-relaxed mt-0.5">
						Verifies each credential ref resolves through the runtime's
						SecretResolver. Does not dial the backend.
					</p>
				</div>
				<Button
					variant="secondary"
					onClick={() => probe.mutate()}
					disabled={probe.isPending}
				>
					<PlugZap className="h-4 w-4" />
					{probe.isPending ? "Testing…" : "Test connection"}
				</Button>
			</div>
			{runtimeError ? (
				<ResultBanner tone="error" title="Probe failed to run">
					{runtimeError}
				</ResultBanner>
			) : null}
			{result ? <ResultFromBody result={result} /> : null}
		</div>
	);
}

function ResultFromBody({ result }: { result: TestConnectionResult }) {
	return (
		<ResultBanner
			tone={result.ok ? "success" : "warning"}
			title={result.ok ? "Credentials look good" : "Credentials can't resolve"}
		>
			{result.details}
		</ResultBanner>
	);
}

function ResultBanner({
	tone,
	title,
	children,
}: {
	tone: "success" | "warning" | "error";
	title: string;
	children: React.ReactNode;
}) {
	const Icon =
		tone === "success"
			? CheckCircle2
			: tone === "warning"
				? AlertTriangle
				: AlertTriangle;

	const styles: Record<typeof tone, string> = {
		success: "bg-emerald-50 border-emerald-200 text-emerald-900",
		warning: "bg-amber-50 border-amber-200 text-amber-900",
		error: "bg-red-50 border-red-200 text-red-900",
	};

	const iconStyles: Record<typeof tone, string> = {
		success: "text-emerald-600",
		warning: "text-amber-600",
		error: "text-red-600",
	};

	return (
		<div
			role="status"
			className={cn(
				"flex items-start gap-3 rounded-lg border p-3",
				styles[tone],
			)}
		>
			<Icon className={cn("h-5 w-5 shrink-0 mt-0.5", iconStyles[tone])} />
			<div className="min-w-0 flex flex-col gap-0.5 text-sm">
				<span className="font-semibold">{title}</span>
				<span className="break-words leading-relaxed">{children}</span>
			</div>
		</div>
	);
}
