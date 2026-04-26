import type { ReactNode } from "react";
import { Link, NavLink, type NavLinkProps } from "react-router-dom";
import { UserMenu } from "@/components/auth/UserMenu";
import { BrandMark } from "@/components/brand/BrandMark";

/**
 * Header-level tab. NavLink with a visible active state that reads
 * as selected at a glance.
 *
 * Active treatment is purely className-driven (no children-as-render-
 * prop) — combining the two NavLink render-prop signatures was
 * suspected of contributing to a "URL changes but content stays"
 * report on tab clicks; this keeps the component's render path
 * minimal.
 */
function NavTab({
	to,
	end,
	children,
}: {
	to: NavLinkProps["to"];
	end?: boolean;
	children: ReactNode;
}) {
	return (
		<NavLink
			to={to}
			end={end}
			className={({ isActive }) =>
				[
					"relative rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
					"max-sm:px-2 max-sm:text-[13px]",
					"after:pointer-events-none after:absolute after:inset-x-3 after:-bottom-px after:h-[2px] after:transition-opacity",
					isActive
						? "text-[#161616] bg-[#e0e0e0] after:bg-[var(--color-brand-500)] after:opacity-100"
						: "text-[#525252] hover:bg-[#f4f4f4] hover:text-[#161616] after:opacity-0",
				].join(" ")
			}
		>
			{children}
		</NavLink>
	);
}

export function AppShell({ children }: { children: ReactNode }) {
	return (
		<div className="min-h-full flex flex-col bg-[#f4f4f4] text-[#161616]">
			<header className="sticky top-0 z-30 border-b border-[#c6c6c6] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/88">
				<div aria-hidden className="h-[3px] w-full bg-[var(--color-brand-500)]" />
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
					<nav className="flex shrink-0 items-center gap-1 text-sm">
						<NavTab to="/" end>
							Workspaces
						</NavTab>
						<NavTab to="/playground">Playground</NavTab>
						<span className="mx-1 h-5 w-px bg-[#c6c6c6]" aria-hidden />
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
