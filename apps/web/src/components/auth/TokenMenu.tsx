import { KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { FieldLabel } from "@/components/ui/field-label";
import { Input } from "@/components/ui/input";
import { useAuthToken } from "@/hooks/useAuthToken";
import { previewToken, setAuthToken } from "@/lib/authToken";

/**
 * Header menu for supplying a workspace-scoped API token.
 *
 * The runtime can be configured to reject anonymous calls
 * (`auth.mode: apiKey`, `anonymousPolicy: reject`). When that happens
 * the UI is unusable without a token — this menu is how an operator
 * supplies one. Token is stored in `localStorage` (see the XSS note
 * in lib/authToken.ts).
 */
export function TokenMenu() {
	const token = useAuthToken();
	const [open, setOpen] = useState(false);
	const [draft, setDraft] = useState("");

	useEffect(() => {
		if (open) setDraft(token ?? "");
	}, [open, token]);

	const hasToken = token !== null;

	function save() {
		const trimmed = draft.trim();
		if (trimmed.length === 0) {
			toast.error("Paste a token first, or use Clear to remove it.");
			return;
		}
		setAuthToken(trimmed);
		toast.success("Token saved", {
			description: `Using ${previewToken(trimmed)} for API calls`,
		});
		setOpen(false);
	}

	function clear() {
		setAuthToken(null);
		toast.success("Token cleared", {
			description: "API calls will be sent without credentials",
		});
		setOpen(false);
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<button
					type="button"
					className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
					aria-label={hasToken ? "Change API token" : "Set API token"}
				>
					{hasToken ? (
						<ShieldCheck
							className="h-4 w-4 text-[var(--color-brand-600)]"
							aria-hidden="true"
						/>
					) : (
						<ShieldAlert
							className="h-4 w-4 text-slate-400"
							aria-hidden="true"
						/>
					)}
					<span className="font-mono text-xs">{previewToken(token)}</span>
				</button>
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<KeyRound className="h-5 w-5 text-[var(--color-brand-600)]" />
						API token
					</DialogTitle>
					<DialogDescription>
						Paste a workspace-scoped token issued by the API-keys UI. It's
						stored in this browser's localStorage and sent as a bearer
						credential on every request. Clearing it sends requests
						unauthenticated.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-col gap-1.5">
					<FieldLabel
						htmlFor="auth-token"
						help="Paste a workspace-scoped API key here. It is stored only in this browser's localStorage and sent as the Authorization bearer token."
					>
						Bearer token
					</FieldLabel>
					<Input
						id="auth-token"
						placeholder="wb_live_…"
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") save();
						}}
						autoFocus
						spellCheck={false}
						autoComplete="off"
					/>
					<p className="text-xs text-slate-500">
						The token never leaves this browser. It's not persisted on the
						server, and only this origin's JavaScript can read it.
					</p>
				</div>
				<DialogFooter>
					{hasToken ? (
						<Button variant="ghost" onClick={clear}>
							Clear
						</Button>
					) : null}
					<Button variant="ghost" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						variant="brand"
						onClick={save}
						disabled={draft.trim().length === 0}
					>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
