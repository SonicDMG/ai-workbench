import { AlertTriangle, CheckCircle2, PlugZap } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useTestConnection } from "@/hooks/useWorkspaces";
import { formatApiError } from "@/lib/api";
import type { TestConnectionResult } from "@/lib/schemas";
import { cn } from "@/lib/utils";

/**
 * Compact trigger + modal result for
 * `POST /workspaces/{workspaceId}/test-connection`.
 */
export function TestConnectionPanel({ workspaceId }: { workspaceId: string }) {
	const probe = useTestConnection(workspaceId);
	const [open, setOpen] = useState(false);
	const result = probe.data;
	const runtimeError = probe.error ? formatApiError(probe.error) : null;

	function runProbe() {
		setOpen(true);
		probe.mutate();
	}

	return (
		<>
			<Button variant="secondary" onClick={runProbe} disabled={probe.isPending}>
				<PlugZap className="h-4 w-4" />
				{probe.isPending ? "Testing…" : "Test Connectivity"}
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Test Connectivity</DialogTitle>
						<DialogDescription>
							Checks whether this workspace can reach its configured Astra
							connection.
						</DialogDescription>
					</DialogHeader>

					<div className="py-2">
						{probe.isPending ? (
							<ResultBanner tone="pending" title="Testing connectivity">
								Contacting the workspace runtime…
							</ResultBanner>
						) : runtimeError ? (
							<ResultBanner tone="error" title="Probe failed to run">
								{runtimeError}
							</ResultBanner>
						) : result ? (
							<ResultFromBody result={result} />
						) : (
							<ResultBanner tone="idle" title="Ready to test">
								Run a connectivity probe against the workspace runtime.
							</ResultBanner>
						)}
					</div>

					<DialogFooter>
						<Button variant="ghost" onClick={() => setOpen(false)}>
							Close
						</Button>
						<Button onClick={runProbe} disabled={probe.isPending}>
							<PlugZap className="h-4 w-4" />
							{probe.isPending ? "Testing…" : "Run again"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

function ResultFromBody({ result }: { result: TestConnectionResult }) {
	return (
		<ResultBanner
			tone={result.ok ? "success" : "warning"}
			title={result.ok ? "Connection passed" : "Connection failed"}
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
	tone: "success" | "warning" | "error" | "pending" | "idle";
	title: string;
	children: React.ReactNode;
}) {
	const Icon =
		tone === "success"
			? CheckCircle2
			: tone === "warning" || tone === "error"
				? AlertTriangle
				: PlugZap;

	const styles: Record<typeof tone, string> = {
		success: "bg-emerald-50 border-emerald-200 text-emerald-900",
		warning: "bg-amber-50 border-amber-200 text-amber-900",
		error: "bg-red-50 border-red-200 text-red-900",
		pending: "bg-sky-50 border-sky-200 text-sky-900",
		idle: "bg-slate-50 border-slate-200 text-slate-900",
	};

	const iconStyles: Record<typeof tone, string> = {
		success: "text-emerald-600",
		warning: "text-amber-600",
		error: "text-red-600",
		pending: "text-sky-600",
		idle: "text-slate-500",
	};

	return (
		<div
			role="status"
			className={cn(
				"flex max-w-md items-start gap-2 rounded-md border px-3 py-2",
				styles[tone],
			)}
		>
			<Icon className={cn("h-4 w-4 shrink-0 mt-0.5", iconStyles[tone])} />
			<div className="min-w-0 flex flex-col gap-0.5 text-xs">
				<span className="font-semibold">{title}</span>
				<span className="break-words leading-relaxed">{children}</span>
			</div>
		</div>
	);
}
