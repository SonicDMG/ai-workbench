# Changesets

This directory drives [Changesets](https://github.com/changesets/changesets)-based
releases. Every PR with user-visible impact should add a markdown
file here describing the change and the version bump it warrants.

## How to add a changeset

```bash
npm run changeset
```

The CLI walks you through picking the affected packages and bump
type (patch / minor / major) and writes a markdown file you commit
alongside your code.

## How a release happens

When release is cut:

```bash
npm run version-packages   # apply pending changesets, bump versions,
                           # regenerate CHANGELOG.md
git push
git tag v<major>.<minor>.<patch>
git push --tags            # release.yml fires
```

See [`../CONTRIBUTING.md`](../CONTRIBUTING.md) for the full
contributor workflow and branch policy.

## What's in scope for changesets?

`packages/aiw-cli` (`@ai-workbench/cli`) is the only publishable
package today. The web app, TypeScript runtime, and site are
**private** workspaces — they ride the same version number for
clarity but aren't published to npm. Changesets ignores them by
configuration; the human-edited `CHANGELOG.md` at the repo root is
the authoritative narrative for the release as a whole.
