import { Boxes } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function AppShell({ children }: { children: ReactNode }) {
	return (
		<div className="min-h-full flex flex-col">
			<header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/80 backdrop-blur">
				<div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between">
					<Link to="/" className="flex items-center gap-2 group">
						<span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white">
							<Boxes className="h-4 w-4" />
						</span>
						<div className="flex flex-col leading-none">
							<span className="text-sm font-semibold text-zinc-900 group-hover:text-zinc-700">
								AI Workbench
							</span>
							<span className="text-xs text-zinc-500">Workspaces</span>
						</div>
					</Link>
					<nav className="flex items-center gap-1 text-sm">
						<a
							href="/docs"
							target="_blank"
							rel="noreferrer"
							className="rounded-md px-3 py-1.5 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900"
						>
							API docs
						</a>
					</nav>
				</div>
			</header>
			<main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
				{children}
			</main>
		</div>
	);
}
