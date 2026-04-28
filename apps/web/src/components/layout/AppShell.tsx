import type { ReactNode } from "react";
import { Link, matchPath, useLocation, useNavigate } from "react-router-dom";
import { UserMenu } from "@/components/auth/UserMenu";
import { BrandMark } from "@/components/brand/BrandMark";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useWorkspaces } from "@/hooks/useWorkspaces";

export function AppShell({ children }: { children: ReactNode }) {
	const { pathname } = useLocation();
	const currentWorkspaceUid = currentWorkspaceUidFromPath(pathname);

	return (
		<div className="min-h-full flex flex-col bg-[#f4f4f4] text-[#161616]">
			<header className="sticky top-0 z-30 border-b border-[#c6c6c6] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/88">
				<div
					aria-hidden
					className="h-[3px] w-full bg-[var(--color-brand-500)]"
				/>
				<div className="mx-auto max-w-6xl px-4 py-3 sm:px-6 flex items-center justify-between gap-3 sm:gap-6">
					<Link
						to="/"
						className="flex min-w-0 items-center gap-2 sm:gap-3 group rounded-md -my-1 -mx-1 px-1 py-1"
					>
						<BrandMark size={28} />
						<div className="flex min-w-0 flex-col leading-none">
							<span className="truncate whitespace-nowrap text-sm font-semibold tracking-tight text-[#161616] group-hover:text-[#393939]">
								AI Workbench
							</span>
							<span className="mt-0.5 hidden truncate whitespace-nowrap text-[11px] font-medium tracking-[0.02em] text-[#525252] sm:block">
								DataStax, an IBM company
							</span>
						</div>
					</Link>
					<WorkspaceSwitcher currentWorkspaceUid={currentWorkspaceUid} />
					<nav className="flex shrink-0 items-center gap-1 text-sm">
						<UserMenu />
						<a
							href="/docs"
							target="_blank"
							rel="noreferrer"
							className="hidden rounded-md px-3 py-1.5 text-[#525252] transition-colors hover:bg-[#f4f4f4] hover:text-[#161616] sm:inline-flex"
						>
							API docs
						</a>
					</nav>
				</div>
			</header>
			<main className="app-backdrop mx-auto w-full max-w-6xl flex-1 px-6 py-10">
				{children}
			</main>
			<footer className="border-t border-[#c6c6c6] bg-white">
				<div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between text-xs text-slate-500">
					<span>
						AI Workbench · DataStax, an IBM company ·{" "}
						<a
							href="https://www.ibm.com/products/datastax"
							target="_blank"
							rel="noreferrer"
							className="text-slate-700 hover:underline"
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
	currentWorkspaceUid,
}: {
	currentWorkspaceUid: string | undefined;
}) {
	const navigate = useNavigate();
	const workspaces = useWorkspaces();
	const currentWorkspace = workspaces.data?.find(
		(w) => w.workspaceId === currentWorkspaceUid,
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
				value={currentWorkspaceUid ?? ""}
				onValueChange={(uid) => navigate(`/workspaces/${uid}`)}
				disabled={rows.length === 0}
			>
				<SelectTrigger
					aria-label="Workspace"
					className="max-w-xs border-slate-200 bg-slate-50 shadow-none"
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

function currentWorkspaceUidFromPath(pathname: string): string | undefined {
	const match =
		matchPath({ path: "/workspaces/:workspaceUid", end: true }, pathname) ??
		matchPath({ path: "/workspaces/:workspaceUid/*", end: false }, pathname);
	return match?.params.workspaceUid;
}
