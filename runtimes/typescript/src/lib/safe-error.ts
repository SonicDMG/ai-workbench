const REDACTIONS: readonly RegExp[] = [
	/AstraCS:[^\s"'`]+/g,
	/sk-[A-Za-z0-9_-]{16,}/g,
	/wb_live_[a-z0-9]{12}_[a-z0-9]{32}/g,
	/Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
	/(api[_-]?key|token|password|secret)=([^&\s]+)/gi,
];

const MAX_MESSAGE_CHARS = 500;

/**
 * Convert unknown failures into bounded, redacted text safe for API
 * responses and persisted job/document status. Logs can carry richer
 * internal context; user-visible state should not preserve credentials
 * copied through SDK exception messages.
 */
export function safeErrorMessage(
	err: unknown,
	fallback = "operation failed",
): string {
	const raw =
		err instanceof Error
			? err.message
			: typeof err === "string"
				? err
				: fallback;
	const trimmed = raw.trim() || fallback;
	const redacted = REDACTIONS.reduce(
		(msg, pattern) =>
			msg.replace(pattern, (_match, key) =>
				typeof key === "string" && key.length > 0
					? `${key}=[redacted]`
					: "[redacted]",
			),
		trimmed,
	);
	if (redacted.length <= MAX_MESSAGE_CHARS) return redacted;
	return `${redacted.slice(0, MAX_MESSAGE_CHARS - 1)}…`;
}
