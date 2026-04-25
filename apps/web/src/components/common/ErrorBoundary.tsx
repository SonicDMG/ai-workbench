import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "@/components/common/states";
import { Button } from "@/components/ui/button";

/**
 * Catches render-time errors thrown by anything below it in the
 * React tree and falls back to a recoverable error UI. Without this,
 * a bug in a route component takes the whole shell down to a blank
 * page — losing the nav, the auth menu, and any in-flight toasts.
 *
 * The boundary is intentionally a class: React's hooks API has no
 * equivalent for componentDidCatch / getDerivedStateFromError as of
 * React 19. Reset is keyed off `resetKey` from the parent so a route
 * change clears the error state automatically (the AppShell threads
 * `pathname` in).
 *
 * Errors thrown inside event handlers, setTimeout callbacks, or
 * async work (await mutations, useEffect handlers) are NOT caught
 * here — those bubble through React's unhandled-error path and
 * should surface as toasts via formatApiError() at the call site.
 * The boundary's job is the render path only.
 */
interface Props {
	readonly children: ReactNode;
	/** When this changes, the boundary resets to render its children. */
	readonly resetKey?: string | number;
}

interface State {
	readonly error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		// Surface to the dev console; in production this is the only
		// trace we get for a render-path crash.
		console.error("[ErrorBoundary] caught render error", error, info);
	}

	componentDidUpdate(prev: Props): void {
		if (prev.resetKey !== this.props.resetKey && this.state.error !== null) {
			this.setState({ error: null });
		}
	}

	render(): ReactNode {
		if (this.state.error === null) return this.props.children;
		return (
			<ErrorState
				title="Something went wrong"
				message={
					this.state.error.message ||
					"An unexpected error broke this view. Try reloading; if it persists, the page console has the stack."
				}
				actions={
					<>
						<Button
							variant="secondary"
							onClick={() => this.setState({ error: null })}
						>
							Try again
						</Button>
						<Button variant="brand" onClick={() => window.location.reload()}>
							Reload page
						</Button>
					</>
				}
			/>
		);
	}
}
