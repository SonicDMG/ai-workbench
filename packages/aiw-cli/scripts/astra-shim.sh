#!/usr/bin/env bash
#
# `astra` shim — pass-through to the real Astra CLI, except for the
# Workbench verbs `astra db workbench` and `astra db ingest`, which are
# routed to `aiw db workbench` / `aiw db ingest`.
#
# Install by symlinking (or copying) this file as `astra` somewhere on
# your PATH ahead of the real binary, for example:
#
#   ln -s "$(npm root -g)/@ai-workbench/cli/scripts/astra-shim.sh" \
#         /usr/local/bin/astra
#
# Real-astra discovery, in order:
#   1. $ASTRA_REAL_BIN  (explicit override)
#   2. /opt/homebrew/bin/astra and /usr/local/bin/astra when they exist
#      and are not this shim
#   3. `command -v astra` results that are not this shim
#
# `aiw` discovery, in order:
#   1. $AIW_BIN
#   2. `command -v aiw`
#
# All exit codes, stdin, stdout, and stderr are forwarded unchanged.

set -euo pipefail

# Recursion guard. If we exec something that turns out to be another
# instance of this shim (e.g. `$ASTRA_REAL_BIN` is itself a symlink to
# us, or someone symlinked us in two places that chain through each
# other), the second entry bails out instead of looping forever.
AIW_SHIM_DEPTH="${AIW_SHIM_DEPTH:-0}"
if [ "$AIW_SHIM_DEPTH" -ge 1 ]; then
	echo "astra(shim): recursion detected — the binary at \$ASTRA_REAL_BIN (or the next \`astra\` on PATH) is also this shim." >&2
	echo "astra(shim): set ASTRA_REAL_BIN to the actual Astra CLI binary (e.g. /opt/homebrew/Cellar/astra/<ver>/bin/astra)." >&2
	exit 127
fi
export AIW_SHIM_DEPTH=$((AIW_SHIM_DEPTH + 1))

self_path=""
if [ -L "${BASH_SOURCE[0]}" ]; then
	# Resolve a single level of symlink without requiring GNU readlink.
	link_target=$(readlink "${BASH_SOURCE[0]}")
	case "$link_target" in
		/*) self_path="$link_target" ;;
		*) self_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd "$(dirname "$link_target")" && pwd)/$(basename "$link_target")" ;;
	esac
else
	self_path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
fi

is_self() {
	[ -n "$self_path" ] && [ "$1" = "$self_path" ]
}

find_real_astra() {
	if [ -n "${ASTRA_REAL_BIN:-}" ]; then
		printf '%s' "$ASTRA_REAL_BIN"
		return 0
	fi
	for candidate in /opt/homebrew/bin/astra /usr/local/bin/astra; do
		if [ -x "$candidate" ] && ! is_self "$candidate"; then
			printf '%s' "$candidate"
			return 0
		fi
	done
	# Walk every PATH match, skipping ourselves.
	while IFS= read -r candidate; do
		[ -z "$candidate" ] && continue
		if [ -x "$candidate" ] && ! is_self "$candidate"; then
			printf '%s' "$candidate"
			return 0
		fi
	done < <(command -v -a astra 2>/dev/null || true)
	return 1
}

find_aiw() {
	if [ -n "${AIW_BIN:-}" ]; then
		printf '%s' "$AIW_BIN"
		return 0
	fi
	if command -v aiw >/dev/null 2>&1; then
		command -v aiw
		return 0
	fi
	return 1
}

route_to_aiw() {
	local verb="$1"
	shift
	local aiw
	if ! aiw=$(find_aiw); then
		echo "astra(shim): \`aiw\` not found on PATH; install @ai-workbench/cli or set AIW_BIN." >&2
		exit 127
	fi
	exec "$aiw" db "$verb" "$@"
}

passthrough() {
	local real
	if ! real=$(find_real_astra); then
		echo "astra(shim): real \`astra\` binary not found. Set ASTRA_REAL_BIN or install the Astra CLI." >&2
		exit 127
	fi
	exec "$real" "$@"
}

# Match `astra db <verb> [args...]` where <verb> is one of our shimmed
# Workbench verbs. Everything else (different verbs, fewer args, other
# subcommand groups, no args) falls straight through.
if [ "$#" -ge 2 ] && [ "$1" = "db" ]; then
	verb="$2"
	case "$verb" in
		workbench|ingest)
			shift 2
			route_to_aiw "$verb" "$@"
			;;
	esac
fi

passthrough "$@"
