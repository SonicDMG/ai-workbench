import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import {
	BrowserRouter,
	Navigate,
	Route,
	Routes,
	useLocation,
} from "react-router-dom";
import { Toaster } from "sonner";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { LoadingState } from "@/components/common/states";
import { AppShell } from "@/components/layout/AppShell";
import { useSilentRefresh } from "@/hooks/useSession";
import { queryClient } from "@/lib/query";
import { PlaygroundPage } from "@/pages/PlaygroundPage";
import { WorkspacesPage } from "@/pages/WorkspacesPage";

// Workspaces is the landing route; Playground is one of two top-level
// nav targets and needs to swap in cleanly when the user clicks its
// tab — keeping it eager eliminates a Suspense boundary from the
// navigation path that was making URL-changes-but-content-stuck reports
// reproducible. The two heavier flow pages stay lazy because they
// pull in react-hook-form + zod, which is what the bundle-split work
// (#36/#37) was actually trying to keep off first paint.
const OnboardingPage = lazy(() =>
	import("@/pages/OnboardingPage").then((m) => ({ default: m.OnboardingPage })),
);
const WorkspaceDetailPage = lazy(() =>
	import("@/pages/WorkspaceDetailPage").then((m) => ({
		default: m.WorkspaceDetailPage,
	})),
);

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<BrowserRouter>
				<SessionRunloop />
				<AppShell>
					<RoutedView />
				</AppShell>
				<Toaster position="bottom-right" richColors closeButton />
			</BrowserRouter>
		</QueryClientProvider>
	);
}

/**
 * Mounts the silent-refresh timer so it lives for the entire app's
 * lifetime, not per-route. Renders nothing — it's a side-effect
 * carrier. Lives below `QueryClientProvider` so it can talk to the
 * shared cache and below `BrowserRouter` only so it sits next to
 * the rest of the routed tree (no router APIs are used here).
 */
function SessionRunloop() {
	useSilentRefresh();
	return null;
}

/**
 * Wraps the routed area in a render-error boundary that resets when
 * the user navigates away. Lives below `BrowserRouter` so it can
 * read `useLocation()` for the reset key — a route change should
 * always clear a stale boundary state. Errors thrown inside event
 * handlers / async work bypass the boundary by design; those should
 * be surfaced as toasts via `formatApiError()` at the call site.
 */
function RoutedView() {
	const { pathname } = useLocation();
	return (
		<ErrorBoundary resetKey={pathname}>
			<Suspense fallback={<LoadingState />}>
				<Routes>
					<Route path="/" element={<WorkspacesPage />} />
					<Route path="/onboarding" element={<OnboardingPage />} />
					<Route path="/workspaces/:uid" element={<WorkspaceDetailPage />} />
					<Route path="/playground" element={<PlaygroundPage />} />
					<Route path="*" element={<Navigate to="/" replace />} />
				</Routes>
			</Suspense>
		</ErrorBoundary>
	);
}
