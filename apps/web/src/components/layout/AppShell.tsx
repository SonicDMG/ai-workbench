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
					"after:pointer-events-none after:absolute after:inset-x-3 after:-bottom-px after:h-[2px] after:rounded-full after:transition-opacity",
					isActive
						? "text-[var(--color-brand-700)] bg-[color-mix(in_oklch,var(--color-brand-500)_10%,white)] after:bg-[var(--color-brand-500)] after:opacity-100"
						: "text-slate-600 hover:bg-slate-100 hover:text-slate-900 after:opacity-0",
				].join(" ")
			}
		>
			{children}
		</NavLink>
	);
}

export function AppShell({ children }: { children: ReactNode }) {
	return (
		<div className="min-h-full flex flex-col">
			<header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur supports-[backdrop-filter]:bg-white/70">
				{/* Thin brand-hued accent line — reads as "this is a DataStax
				    product" at a glance without needing a big masthead. */}
				<div
					aria-hidden
					className="h-[2px] w-full"
					style={{ background: "var(--gradient-brand)" }}
				/>
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
					<nav className="flex items-center gap-1 text-sm">
						<NavTab to="/" end>
							Workspaces
						</NavTab>
						<NavTab to="/playground">Playground</NavTab>
						<span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
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
			<main className="app-backdrop mx-auto w-full max-w-6xl flex-1 px-6 py-10">
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
