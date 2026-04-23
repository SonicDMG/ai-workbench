import { useEffect, useState } from "react";
import { getAuthToken, subscribe } from "@/lib/authToken";

/**
 * Subscribe to the current auth token. Re-renders on change (same tab
 * via CustomEvent, cross-tab via the storage event).
 */
export function useAuthToken(): string | null {
	const [token, setToken] = useState<string | null>(() => getAuthToken());
	useEffect(() => subscribe(setToken), []);
	return token;
}
