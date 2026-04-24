import { LogIn, LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuthConfig, useSession } from "@/hooks/useSession";
import { loginHref, logout } from "@/lib/session";
import { TokenMenu } from "./TokenMenu";

/**
 * Header credential surface.
 *
 * Decision tree:
 *   1. OIDC session valid  → show user label + logout
 *   2. OIDC login available → show "Log in" button
 *   3. API-key mode available → show the paste-a-token menu
 *   4. Nothing configured → show nothing (auth is disabled)
 *
 * The UserMenu intentionally replaces TokenMenu when OIDC login is
 * configured; operators still using API keys have the programmatic
 * /api/v1/workspaces/{w}/api-keys flow for creating them.
 */
export function UserMenu() {
	const cfg = useAuthConfig();
	const session = useSession();

	// `isLoading` (pending AND actually fetching) instead of
	// `isPending` so a disabled session query — which happens when
	// OIDC browser-login isn't configured — doesn't leave the menu
	// stuck in its skeleton placeholder forever.
	if (cfg.isLoading || session.isLoading) {
		return <div aria-hidden className="h-8 w-8 rounded-full bg-slate-100" />;
	}
	const modes = cfg.data?.modes;
	const loginPath = cfg.data?.loginPath;
	const subj = session.data;

	if (subj) {
		return <SignedIn label={subj.label ?? subj.id} />;
	}

	if (modes?.login && loginPath) {
		return <LoginButton loginPath={loginPath} />;
	}

	if (modes?.apiKey) {
		return <TokenMenu />;
	}
	return null;
}

function LoginButton({ loginPath }: { loginPath: string }) {
	const onClick = () => {
		const here = window.location.pathname + window.location.search;
		window.location.assign(loginHref(loginPath, here));
	};
	return (
		<Button variant="brand" size="sm" onClick={onClick}>
			<LogIn className="h-4 w-4" aria-hidden="true" />
			Log in
		</Button>
	);
}

function SignedIn({ label }: { label: string }) {
	const onLogout = async () => {
		try {
			await logout();
			window.location.assign("/");
		} catch (err) {
			toast.error("Logout failed", {
				description: err instanceof Error ? err.message : "Unknown error",
			});
		}
	};
	return (
		<div className="flex items-center gap-2">
			<span className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-3 py-1 text-sm text-slate-700">
				<UserRound
					className="h-4 w-4 text-[var(--color-brand-600)]"
					aria-hidden="true"
				/>
				<span className="max-w-[160px] truncate font-medium" title={label}>
					{label}
				</span>
			</span>
			<button
				type="button"
				onClick={onLogout}
				className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
				aria-label="Log out"
			>
				<LogOut className="h-4 w-4" aria-hidden="true" />
				<span className="sr-only sm:not-sr-only">Log out</span>
			</button>
		</div>
	);
}
