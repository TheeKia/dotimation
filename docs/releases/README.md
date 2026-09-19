# Release notes

Before releasing, write and commit `docs/releases/<version>.md`. Then run:

```sh
bun run release 0.8.0 --dry-run
bun run release 0.8.0
```

Use the version you intend to ship; these commands are examples. All three
packages receive that version. The private root package version is unchanged.

Describe user-facing changes, migration steps and affected adapters. A suggested
structure (omit sections that do not apply):

```markdown
## Core
- Describe shared rendering or runtime changes.

## React
- Describe React API or behavior changes.

## Svelte
- Describe Svelte API or behavior changes.

## Migration
- Explain breaking changes and required user actions.
```

Alternatively, pass `--notes /absolute/path/to/notes.md` to import an external file
into the release commit. A notes file inside the repository must be committed
first because the command requires a clean working tree. Notes are required for
both dry runs and releases; the script cannot infer user-facing changes.

Prereleases such as `0.9.0-beta.1` use npm's `next` tag and GitHub's prerelease flag.
Stable releases use `latest`. Versions must increase, with no `v` prefix or build
metadata. Promotion is a new stable release, e.g. `0.9.0-beta.1` → `0.9.0`.

The script requires clean `main` matching the remote, an unused tag, and synchronized
package versions. It refreshes the lockfile without updating dependency ranges,
runs lint, builds, type checks, unit tests, both playground builds, browser/GPU
checks and packed-consumer tests, then creates a commit and annotated tag and
pushes both atomically. Install Playwright Chromium before releasing. Linux also
needs Xvfb (installed by Playwright's `install --with-deps chromium`).

A dry run checks prerequisites and prints the plan/notes without changing files,
refs, dependencies or remote state. It does not run validation or test push permissions.

If validation fails, the release's manifest, lockfile and notes edits are restored.
Generated build output may remain. If committing succeeds but tagging or pushing
fails, the local commit is retained and the command prints the atomic push to
retry. Never force-push a published tag. If the remote advanced or branch protection
rejects the push, resolve that deliberately; the script does not bypass protections.

After a successful push, follow the Release workflow in GitHub Actions. Its failure
does not require a new tag: rerun failed jobs to finish a partial publication.
Published package versions are skipped; registry errors are fatal. Release notes
are created or updated from the versioned Markdown, so a notes-step retry is safe.
Actual npm publishing happens only in CI through Trusted Publishing.
