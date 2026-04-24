import { QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { LoadingState } from "@/components/common/states";
import { AppShell } from "@/components/layout/AppShell";
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
