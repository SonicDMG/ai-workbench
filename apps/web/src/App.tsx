import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { queryClient } from "@/lib/query";
import { OnboardingPage } from "@/pages/OnboardingPage";
import { WorkspaceDetailPage } from "@/pages/WorkspaceDetailPage";
import { WorkspacesPage } from "@/pages/WorkspacesPage";

export function App() {
	return (
		<QueryClientProvider client={queryClient}>
			<BrowserRouter>
				<AppShell>
					<Routes>
						<Route path="/" element={<WorkspacesPage />} />
						<Route path="/onboarding" element={<OnboardingPage />} />
						<Route path="/workspaces/:uid" element={<WorkspaceDetailPage />} />
						<Route path="*" element={<Navigate to="/" replace />} />
					</Routes>
				</AppShell>
				<Toaster position="bottom-right" richColors closeButton />
			</BrowserRouter>
		</QueryClientProvider>
	);
}
