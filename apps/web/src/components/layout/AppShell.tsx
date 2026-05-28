import { BookOpen, Cog } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Link, matchPath, useLocation, useNavigate } from "react-router-dom";
import { UserMenu } from "@/components/auth/UserMenu";
import { BrandMark } from "@/components/brand/BrandMark";
import { ThemeSwitcher } from "@/components/layout/ThemeSwitcher";
import {
	WhatsNewModal,
	WhatsNewTrigger,
} from "@/components/onboarding/WhatsNewModal";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useSetupStatus } from "@/hooks/useSetupStatus";
import { useWorkspaces } from "@/hooks/useWorkspaces";
import { APP_VERSION } from "@/lib/version";

export function AppShell({ children }: { children: ReactNode }) {
	const { pathname } = useLocation();
	const currentWorkspaceId = currentWorkspaceIdFromPath(pathname);
	useRescueModeRedirect();

	return (
		<div className="min-h-full flex flex-col bg-[var(--app-bg)] text-[var(--app-fg)]">
			<header className="sticky top-0 z-30 border-b border-[#c6c6c6] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/88 dark:border-slate-800 dark:bg-slate-900/90 dark:supports-[backdrop-filter]:bg-slate-900/80">
				<div
					aria-hidden
					className="h-[3px] w-full bg-[var(--color-brand-500)]"
				/>
				<div className="mx-auto grid max-w-6xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 py-3 sm:gap-6 sm:px-6">
					<Link
						to="/"
						className="group -my-1 -mx-1 flex min-w-0 items-center gap-2 rounded-md px-1 py-1 sm:gap-3"
					>
						<BrandMark size={28} />
						<div className="hidden min-w-0 flex-col leading-none min-[390px]:flex">
							<span className="flex items-center gap-1.5 truncate whitespace-nowrap text-sm font-semibold tracking-tight text-[#161616] group-hover:text-[#393939] dark:text-slate-100 dark:group-hover:text-white">
								AI Workbench
								<span
									className="rounded-full border border-amber-300 bg-amber-50 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
									title={`v${APP_VERSION}`}
								>
									v{APP_VERSION}
								</span>
							</span>
							<span className="mt-0.5 hidden truncate whitespace-nowrap text-[11px] font-medium tracking-[0.02em] text-[#525252] sm:block dark:text-slate-400">
								IBM
							</span>
						</div>
					</Link>
					<WorkspaceSwitcher currentWorkspaceId={currentWorkspaceId} />
					<nav className="flex shrink-0 items-center gap-1 text-sm">
						<ThemeSwitcher />
						<a
							href="/docs"
							target="_blank"
							rel="noreferrer"
							className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#525252] transition-colors hover:bg-[#f4f4f4] hover:text-[#161616] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
							aria-label="API docs"
							title="API docs"
						>
							<BookOpen className="h-4 w-4" />
						</a>
						<WhatsNewTrigger />
						<Link
							to="/settings"
							className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[#525252] transition-colors hover:bg-[#f4f4f4] hover:text-[#161616] dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
							aria-label="Runtime settings"
							title="Runtime settings"
						>
							<Cog className="h-4 w-4" />
						</Link>
						<UserMenu />
					</nav>
				</div>
			</header>
			<main className="app-backdrop mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">
				{children}
			</main>
			<WhatsNewModal />
			<footer className="border-t border-[#c6c6c6] bg-white dark:border-slate-800 dark:bg-slate-900">
				<div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-4 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:text-slate-400">
					<span>
						AI Workbench · IBM ·{" "}
						<a
							href="https://www.ibm.com/products/datastax"
							target="_blank"
							rel="noreferrer"
							className="text-slate-700 hover:underline dark:text-slate-200"
						>
							IBM DataStax
						</a>{" "}
					</span>
					<span className="font-mono">/api/v1</span>
				</div>
			</footer>
		</div>
	);
}

function WorkspaceSwitcher({
	currentWorkspaceId,
}: {
	currentWorkspaceId: string | undefined;
}) {
	const navigate = useNavigate();
	const workspaces = useWorkspaces();
	const currentWorkspace = workspaces.data?.find(
		(w) => w.workspaceId === currentWorkspaceId,
	);

	if (workspaces.isLoading) {
		return (
			<div className="flex min-w-0 flex-1 items-center">
				<span className="h-9 w-full max-w-xs rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-400">
					Loading workspaces…
				</span>
			</div>
		);
	}

	const rows = workspaces.data ?? [];

	return (
		<div className="flex min-w-0 flex-1 items-center gap-2">
			<Select
				value={currentWorkspaceId ?? ""}
				onValueChange={(workspaceId) => navigate(`/workspaces/${workspaceId}`)}
				disabled={rows.length === 0}
			>
				<SelectTrigger
					aria-label="Workspace"
					className="min-w-0 max-w-[12rem] border-slate-200 bg-slate-50 shadow-none sm:max-w-xs"
				>
					<SelectValue
						placeholder={
							currentWorkspace?.name ??
							(rows.length === 0 ? "No workspaces" : "Select workspace")
						}
					/>
				</SelectTrigger>
				<SelectContent>
					{rows.map((workspace) => (
						<SelectItem
							key={workspace.workspaceId}
							value={workspace.workspaceId}
						>
							<span className="flex min-w-0 items-baseline gap-2">
								<span className="truncate">{workspace.name}</span>
								<span className="font-mono text-xs text-slate-500">
									{workspace.kind}
								</span>
							</span>
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			{rows.length === 0 ? (
				<Button variant="secondary" size="sm" asChild>
					<Link to="/onboarding">New</Link>
				</Button>
			) : null}
		</div>
	);
}

function currentWorkspaceIdFromPath(pathname: string): string | undefined {
	const match =
		matchPath({ path: "/workspaces/:workspaceId", end: true }, pathname) ??
		matchPath({ path: "/workspaces/:workspaceId/*", end: false }, pathname);
	return match?.params.workspaceId;
}

/**
 * When the runtime is in rescue mode (control-plane init failed), redirect
 * users from data routes to `/settings` so they immediately land on the
 * credentials editor. Without this they'd be stuck on a workspaces list
 * that 503s forever. Stays out of the way on `/settings`, `/onboarding`,
 * and `/status` — those are the routes that work in rescue mode.
 */
function useRescueModeRedirect(): void {
	const { data: status } = useSetupStatus();
	const navigate = useNavigate();
	const { pathname } = useLocation();
	useEffect(() => {
		if (!status?.bootError) return;
		if (
			pathname.startsWith("/settings") ||
			pathname.startsWith("/onboarding") ||
			pathname.startsWith("/status")
		) {
			return;
		}
		navigate("/settings", { replace: true });
	}, [status?.bootError, pathname, navigate]);
}
