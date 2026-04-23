import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { UserMenu } from "@/components/auth/UserMenu";
import { BrandMark } from "@/components/brand/BrandMark";

export function AppShell({ children }: { children: ReactNode }) {
	return (
		<div className="min-h-full flex flex-col">
			<header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
				<div className="mx-auto max-w-6xl px-6 py-3 flex items-center justify-between gap-6">
					<Link
						to="/"
						className="flex items-center gap-3 group rounded-md -my-1 -mx-1 px-1 py-1"
					>
						<BrandMark size={28} />
						<div className="flex flex-col leading-none">
							<span className="text-sm font-semibold tracking-tight text-slate-900 group-hover:text-slate-700">
								AI Workbench
							</span>
							<span className="text-[11px] uppercase tracking-[0.08em] text-slate-500 font-medium mt-0.5">
								DataStax Astra
							</span>
						</div>
					</Link>
					<nav className="flex items-center gap-2 text-sm">
						<UserMenu />
						<a
							href="/docs"
							target="_blank"
							rel="noreferrer"
							className="rounded-md px-3 py-1.5 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
						>
							API docs
						</a>
					</nav>
				</div>
			</header>
			<main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
				{children}
			</main>
			<footer className="border-t border-slate-200 bg-white/60">
				<div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between text-xs text-slate-500">
					<span>
						AI Workbench · Part of{" "}
						<a
							href="https://www.datastax.com/"
							target="_blank"
							rel="noreferrer"
							className="text-slate-700 hover:underline"
						>
							DataStax
						</a>{" "}
						at IBM
					</span>
					<span className="font-mono">/api/v1</span>
				</div>
			</footer>
		</div>
	);
}
