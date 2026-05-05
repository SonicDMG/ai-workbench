/**
 * Format an HTTP request as a cURL command suitable for pasting into
 * a terminal. Emits a multi-line layout with continuation backslashes
 * for readability — the same shape we use in docs/examples.
 *
 * Quoting strategy: single-quote everything (URL, header values, body)
 * and escape embedded `'` as `'\''`. This is the conventional shell-
 * safe approach and keeps the encoded string deterministic regardless
 * of what JSON content lands in the body.
 */

export interface CurlRequest {
	readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	readonly url: string;
	readonly headers?: Readonly<Record<string, string>>;
	/**
	 * Already-stringified body. Pass the same JSON the real fetch would
	 * send so the cURL is a faithful reproduction. Pass `undefined` for
	 * GET / DELETE.
	 */
	readonly body?: string;
}

export function formatCurl(request: CurlRequest): string {
	const lines: string[] = [
		`curl -X ${request.method} ${shellQuote(request.url)}`,
	];
	for (const [name, value] of Object.entries(request.headers ?? {})) {
		lines.push(`  -H ${shellQuote(`${name}: ${value}`)}`);
	}
	if (request.body !== undefined) {
		lines.push(`  --data ${shellQuote(request.body)}`);
	}
	return lines.join(" \\\n");
}

/**
 * Wrap `s` in single quotes, escaping any embedded single quote via
 * the canonical close-quote / backslash-quote / open-quote sequence
 * (`'\''`). Safe for any character set including newlines.
 */
export function shellQuote(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}
