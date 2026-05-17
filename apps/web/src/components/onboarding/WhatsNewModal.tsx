import { ExternalLink, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	WHATS_NEW_HIGHLIGHTS,
	WHATS_NEW_VERSION,
} from "@/lib/whats-new-content";

/**
 * Auto-opens once per release on first visit, then stays available
 * via the header trigger (`<WhatsNewTrigger />`) for as long as the
 * release is current. Dismissals persist under
 * `aiw:wn:${WHATS_NEW_VERSION}` so the auto-open fires again the
 * next time the version bumps.
 *
 * `localStorage` is read lazily inside an effect so SSR / first
 * render stays deterministic; the modal flickers open briefly only
 * if the user actively dismissed a *prior* version's modal and
 * hasn't seen the new one yet — same trade-off the standard
 * dismissable-banner pattern accepts.
 */

const STORAGE_KEY_PREFIX = "aiw:wn:";
const storageKey = `${STORAGE_KEY_PREFIX}${WHATS_NEW_VERSION}`;

function readDismissed(): boolean {
	if (typeof window === "undefined") return true;
	try {
		return window.localStorage.getItem(storageKey) === "1";
	} catch {
		// localStorage can throw in Safari private mode / sandboxed iframes;
		// treat as already-dismissed to avoid a permanent open dialog the
		// user can't suppress.
		return true;
	}
}

function writeDismissed(): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(storageKey, "1");
	} catch {
		// Best effort — the dialog still closes for the current session
		// even if we can't persist.
	}
}

export function WhatsNewModal() {
	const [open, setOpen] = useState(false);
	// Track whether we've consulted localStorage yet so a programmatic
	// open from the header trigger doesn't re-evaluate the auto-open
	// rule on every render.
	const autoOpenedRef = useRef(false);

	useEffect(() => {
		if (autoOpenedRef.current) return;
		autoOpenedRef.current = true;
		if (!readDismissed() && WHATS_NEW_HIGHLIGHTS.length > 0) {
			setOpen(true);
		}
	}, []);

	const onOpenChange = useCallback((next: boolean) => {
		setOpen(next);
		if (!next) writeDismissed();
	}, []);

	// Expose a programmatic open via a CustomEvent so the header
	// trigger can live in its own subtree without prop-drilling. Same
	// pattern the toast surface uses elsewhere in the app.
	useEffect(() => {
		function handle() {
			setOpen(true);
		}
		window.addEventListener(OPEN_EVENT, handle);
		return () => window.removeEventListener(OPEN_EVENT, handle);
	}, []);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<span
							aria-hidden
							className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-brand-50)] text-[var(--color-brand-700)]"
						>
							<Sparkles className="h-3.5 w-3.5" />
						</span>
						What's new in {WHATS_NEW_VERSION}
					</DialogTitle>
					<DialogDescription>
						A quick tour of the headline changes since the last release.
					</DialogDescription>
				</DialogHeader>

				<ul className="flex flex-col gap-4">
					{WHATS_NEW_HIGHLIGHTS.map((item) => (
						<li
							key={item.title}
							className="rounded-md border border-slate-200 bg-slate-50/60 p-3 dark:border-slate-700 dark:bg-slate-800/40"
						>
							<h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
								{item.title}
							</h3>
							<p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
								{item.summary}
							</p>
							{item.link ? (
								<a
									href={item.link.href}
									target="_blank"
									rel="noreferrer"
									className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] hover:underline"
								>
									{item.link.label}
									<ExternalLink className="h-3 w-3" aria-hidden />
								</a>
							) : null}
						</li>
					))}
				</ul>

				<DialogFooter>
					<DialogClose asChild>
						<Button variant="brand" size="sm">
							Got it
						</Button>
					</DialogClose>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

/**
 * The header trigger — a small icon button operators can click to
 * reopen the modal on demand. Kept as a separate export so AppShell
 * can place the trigger in the nav while the modal portal lives at
 * the page root.
 */
export function WhatsNewTrigger() {
	const onClick = useCallback(() => {
		window.dispatchEvent(new Event(OPEN_EVENT));
	}, []);
	return (
		<button
			type="button"
			onClick={onClick}
			title={`What's new in ${WHATS_NEW_VERSION}`}
			aria-label={`What's new in ${WHATS_NEW_VERSION}`}
			className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)] dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
		>
			<Sparkles className="h-4 w-4" aria-hidden />
		</button>
	);
}

const OPEN_EVENT = "aiw:whats-new:open";
