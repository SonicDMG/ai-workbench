---
"@ai-workbench/cli": minor
---

Runtime: commit the RLAC `PolicyAuditRecord` shape, the `PolicyAction` verb set, and the `PolicyDecision` outcome set as the stable public contract starting 0.2.0. SIEM ingestion and downstream alerting can rely on these without parsing tool-specific reason strings. Additive changes (new optional fields, new enum members) stay non-breaking; renames or removals require a one-minor-release deprecation window announced under **Changed**. A new `PolicyAuditRecordV1` type alias re-exports the current shape so future breaking evolutions can land as `V2` alongside V1 without breaking integrators. Enforced by `runtimes/typescript/tests/policy/audit-shape-lock.test.ts`. The Preview label on the workspace-settings access-control card stays — it now covers only the policy DSL (visibility-list semantics only), not the audit-log wire shape.
