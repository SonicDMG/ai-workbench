## Summary

<!-- What changed, why it changed, and who it affects. -->

## Validation

<!-- List the checks you ran, or explain why a check is not applicable. -->

## Checklist

- [ ] Branched from `main` with a descriptive prefix (`feat/`, `fix/`,
  `chore/`, `docs/`, `refactor/`, or `test/`).
- [ ] Commit messages follow Conventional Commits.
- [ ] This PR focuses on one concern.
- [ ] Tests are included for new behavior or bug fixes, or the reason they are
  not applicable is documented above.
- [ ] Relevant local checks passed (`npm run check`, or the narrower commands
  listed in `CONTRIBUTING.md`).
- [ ] I did not skip hooks with `--no-verify` or `--no-gpg-sign`.
- [ ] I added a changeset for user-visible CLI, API, UI, or contract-impacting
  documentation changes, or documented why one is not needed.
- [ ] If this changes the HTTP API contract, I updated `docs/api-spec.md`, added
  or regenerated conformance coverage, and kept runtime scaffolds in sync.
- [ ] If this changes `workbench.yaml`, I documented the migration and kept
  examples current.
- [ ] I removed or redacted secrets, credentials, tokens, and private data.
