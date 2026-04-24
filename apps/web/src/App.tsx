import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { LoadingState } from "@/components/common/states";
import { AppShell } from "@/components/layout/AppShell";
import { queryClient } from "@/lib/query";
import { WorkspacesPage } from "@/pages/WorkspacesPage";

// The list page is the landing route and cheap to render, so it's
// eager. The detail + onboarding pages pull in react-hook-form,
// @hookform/resolvers, and a chunk of workspace-specific UI that
// first-paint users rarely need; lazy-load them so the initial
// bundle stays under the ~500 kB warning threshold.
const OnboardingPage = lazy(() =>
	import("@/pages/OnboardingPage").then((m) => ({ default: m.OnboardingPage })),
);
const WorkspaceDetailPage = lazy(() =>
	import("@/pages/WorkspaceDetailPage").then((m) => ({
		default: m.WorkspaceDetailPage,
	})),
);
const PlaygroundPage = lazy(() =>
	import("@/pages/PlaygroundPage").then((m) => ({ default: m.PlaygroundPage })),
);

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<BrowserRouter>
				<AppShell>
					<Suspense fallback={<LoadingState />}>
						<Routes>
							<Route path="/" element={<WorkspacesPage />} />
							<Route path="/onboarding" element={<OnboardingPage />} />
							<Route
								path="/workspaces/:uid"
								element={<WorkspaceDetailPage />}
							/>
							<Route path="/playground" element={<PlaygroundPage />} />
							<Route path="*" element={<Navigate to="/" replace />} />
						</Routes>
					</Suspense>
				</AppShell>
				<Toaster position="bottom-right" richColors closeButton />
			</BrowserRouter>
		</QueryClientProvider>
	);
}
