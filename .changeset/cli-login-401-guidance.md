---
"@ai-workbench/cli": patch
---

`aiw login` is much sharper about runtime auth mismatches:

- **Probes `/auth/config` before prompting** for the API key. If the runtime is in `auth.mode: disabled` (the schema default, which `npm run dev` picks up when `workbench.yaml` has no `auth:` block) or `auth.mode: oidc` only, the CLI warns upfront so you know not to paste a key into a runtime that won't verify it.
- **Normalizes the pasted key** — trims whitespace, strips one layer of matching quotes, and drops a leading `Bearer ` (in case you copied the full Authorization header).
- **Warns when the key doesn't start with `wb_live_`**, the documented format.
- **Translates the runtime's 401 messages** (`token did not match any configured auth scheme`, `api key not recognized`, `revoked`, `expired`, `digest did not match`) into actionable next steps instead of echoing the server error. The `disabled`-mode case is the first bullet so the most common cause is the most visible.
